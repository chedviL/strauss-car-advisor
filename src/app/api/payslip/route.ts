// src/app/api/payslip/route.ts
// זרימת תלוש מקצה לקצה. זהות הבעלים מה-cookie בלבד.
//   POST ?action=upload   (ברירת מחדל): ולידציה + אחסון פרטי + סימון בהיסטוריה. חינם.
//   POST ?action=extract  : חילוץ בעזרת המודל (בתשלום). שומר על השורה לשחזור.
//   POST ?action=apply    : החלה על התיק (אידמפוטנטי - לא מחיל פעמיים). חינם.
//   GET  ?pending=1        : חילוץ שממתין לאישור בתיק הפעיל (לשחזור אחרי רענון).
// תוכן המסמך = נתונים בלבד; אינו נכנס להקשר השיחה. ההיסטוריה מראה רק "הועלה מסמך".

import { cookies } from "next/headers";
import { caseService } from "../../../server/web/service.js";
import { getSessionUser } from "../../../server/auth/next-session.js";
import {
  validatePayslip, storePayslip, readPayslipBytes,
  saveExtraction, discardPayslip, loadPendingExtraction, loadExtractionByUpload,
} from "../../../server/web/payslip-storage.js";
import { extractPayslip, PayslipQuotaError, PayslipFallbackUnavailable, PayslipTimeoutError, type PayslipExtraction } from "../../../server/agent/payslip-extract.js";
import { checkRateLimit } from "../../../server/web/rate-limit.js";
import { isUuid } from "../../../domain/ids.js";
import { InvalidFactsError } from "../../../server/services/facts-validation.js";

export const runtime = "nodejs";
// 60s: gemini-flash-lite-latest extracts in ~5-15s. Budget: 50s for extraction
// (2 attempts) + 10s margin for save and response before Vercel's maxDuration.
export const maxDuration = 60;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function activeCaseId(owner: string): Promise<string> {
  const store = await cookies();
  let caseId = store.get("strauss_case")?.value ?? null;
  const service = caseService();
  // עוגייה פגומה (לא UUID) לא מגיעה ל-DB: מתייחסים אליה כאל "אין תיק פעיל".
  const state = isUuid(caseId) ? await service.getCaseState(caseId, owner) : null;
  if (!state) {
    const created = await service.startBlankCase(owner);
    caseId = created.case.id;
    store.set("strauss_case", caseId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  }
  return caseId!;
}

export async function GET(req: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ error: "auth_required" }, 401);
  const owner = user.id;
  const conn = process.env.DATABASE_URL;
  if (!conn) return json({ pending: null });
  const url = new URL(req.url);
  if (url.searchParams.get("pending") !== "1") return json({ pending: null });
  // caseId: קודם מ-query param (לשוניות מרובות), אחר כך עוגייה.
  const qCaseId = (url.searchParams.get("c") ?? "").trim();
  const store = await cookies();
  const cookieCaseId = store.get("strauss_case")?.value ?? null;
  const caseId = isUuid(qCaseId) ? qCaseId : (isUuid(cookieCaseId) ? cookieCaseId : null);
  if (!caseId) return json({ pending: null });
  const pend = await loadPendingExtraction({ connectionString: conn, ownerId: owner, caseId }).catch(() => null);
  return json({ pending: pend });
}

export async function POST(req: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ error: "auth_required" }, 401);
  const owner = user.id;
  const conn = process.env.DATABASE_URL;
  if (!conn) return json({ error: "אחסון לא זמין בסביבה זו." }, 503);
  const service = caseService();
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "upload";

  try {
    if (action === "upload") {
      // הגבלת קצב: עד 10 העלאות לדקה לכל בעלים (קו הגנה ראשון; RLS הוא המהותי).
      const rl = checkRateLimit(`payslip-upload:${owner}`, 10, 60_000);
      if (!rl.allowed) {
        return json({ error: "יותר מדי העלאות בזמן קצר. נסו שוב בעוד רגע.", kind: "rate_limit", retryAfterSeconds: rl.retryAfterSeconds }, 429);
      }
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return json({ error: "לא צורף קובץ." }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const v = validatePayslip(bytes);
      if (!v.ok) return json({ error: v.error.message, kind: v.error.kind }, 400);

      const caseId = await activeCaseId(owner);
      const name = typeof file.name === "string" ? file.name.slice(0, 120) : null;
      const stored = await storePayslip({
        connectionString: conn, ownerId: owner, caseId, bytes, mime: v.mime, originalName: name,
      });
      // סימון קצר בהיסטוריה - *לא* תוכן המסמך. שורד רענון כמו כל הודעה.
      await service.appendMessages(caseId, owner, [
        { role: "user", clientMessageId: "payslip-" + stored.id, content: [{ type: "text", text: `📎 הועלה מסמך: ${name ?? "תלוש"}` }] },
      ]).catch(() => {});
      return json({
        status: "uploaded", uploadId: stored.id, mime: stored.mime, sizeBytes: stored.sizeBytes, originalName: stored.originalName,
        extractEstimate: "חילוץ הנתונים משתמש במודל (קריאה אחת). לאישורך לפני ההרצה.",
      });
    }

    if (action === "extract") {
      const body = (await req.json().catch(() => ({}))) as { uploadId?: string };
      if (!isUuid(body.uploadId)) return json({ error: "חסר מזהה העלאה." }, 400);

      // מניעת קריאת מודל חוזרת: אם כבר קיים חילוץ שמור לאותו מסמך (רענון/לחיצה
      // כפולה), מחזירים אותו מיד - *ללא* קריאת מודל ו*ללא* צריכת מגבלת הקצב.
      const cached = await loadExtractionByUpload({ connectionString: conn, ownerId: owner, uploadId: body.uploadId }).catch(() => null);
      if (cached) {
        return json({ status: "extracted", uploadId: body.uploadId, extraction: cached, cached: true });
      }

      // הגבלת קצב לחילוץ (קריאת מודל): עד 6 חילוצים לדקה לכל בעלים.
      const rlx = checkRateLimit(`payslip-extract:${owner}`, 6, 60_000);
      if (!rlx.allowed) {
        return json({ error: "יותר מדי בקשות חילוץ בזמן קצר. נסו שוב בעוד רגע.", kind: "rate_limit", retryAfterSeconds: rlx.retryAfterSeconds }, 429);
      }
      const file = await readPayslipBytes({ connectionString: conn, ownerId: owner, uploadId: body.uploadId });
      if (!file) return json({ error: "הקובץ לא נמצא או אינו שייך לך." }, 404);
      let extraction: PayslipExtraction;
      try {
        extraction = await extractPayslip(file.bytes, file.mime);
      } catch (e) {
        // מדיניות שמירה: *אין* מחיקה אוטומטית של הקובץ בגלל כשל חילוץ. ההעלאה
        // נשמרת; המשתמשת יכולה לנסות שוב, להחליף או למחוק אותה ידנית (action=discard).
        if (e instanceof PayslipQuotaError) {
          // פרטי מכסה ללוג בלבד (איזו מכסה, וזמן המתנה מומלץ אם נמסר). ללא סודות/תוכן.
          const d = e.details;
          console.warn(`[payslip] quota: metric=${d.metric ?? "?"} retryAfterSec=${d.retryAfterSeconds ?? "?"} raw=${d.raw}`);
          return json({
            error: d.retryAfterSeconds
              ? `מכסת החילוץ האוטומטי נוצלה כרגע. אפשר לנסות שוב בעוד כ-${Math.ceil(d.retryAfterSeconds / 60)} דקות, או להזין ידנית ב״הפרטים שלי״.`
              : "מכסת החילוץ האוטומטי נוצלה כרגע. אפשר לנסות שוב מאוחר יותר, או להזין ידנית ב״הפרטים שלי״.",
            kind: "quota",
            retryAfterSeconds: d.retryAfterSeconds ?? null,
            canRetry: true,
          }, 429);
        }
        if (e instanceof PayslipTimeoutError) {
          // Gemini לא ענה בזמן. קובץ נשמר — אפשר לנסות שוב.
          console.warn("[payslip] extraction timed out");
          return json({
            error: "החילוץ מתעכב כרגע. אפשר לנסות שוב או להזין את הנתונים ידנית. הקובץ שלך נשמר.",
            kind: "timeout",
            canRetry: true,
          }, 504);
        }
        if (e instanceof PayslipFallbackUnavailable) {
          // מכסת Gemini נוצלה וגיבוי Claude אינו זמין (כבוי/תקרת עמודים/תקרת עלות).
          console.warn(`[payslip] fallback unavailable: ${e.reason}`);
          return json({
            error: "חילוץ אוטומטי אינו זמין כרגע. אפשר לנסות שוב מאוחר יותר, או להזין את הנתונים ידנית ב״הפרטים שלי״.",
            kind: "quota",
            canRetry: true,
          }, 429);
        }
        const m = e instanceof Error ? e.message : String(e);
        console.warn(`[payslip] extract failed (unreadable): ${m.replace(/key[=:]\S+/gi, "key=***").slice(0, 200)}`);
        // כשל קריאה/פענוח: הקובץ *נשאר* שמור; מציעים לנסות שוב/להחליף/למחוק.
        return json({
          error: "לא הצלחתי לקרוא את המסמך. אפשר לנסות שוב, להעלות קובץ ברור יותר (סריקה חדה, ללא חיתוך), או להזין ידנית ב״הפרטים שלי״.",
          kind: "unreadable",
          canRetry: true,
        }, 422);
      }
      await saveExtraction({ connectionString: conn, ownerId: owner, uploadId: body.uploadId, extraction }).catch(() => {});
      return json({ status: "extracted", uploadId: body.uploadId, extraction });
    }

    if (action === "apply") {
      const body = (await req.json().catch(() => ({}))) as { uploadId?: string; patch?: Record<string, number | null>; caseId?: string };
      if (!isUuid(body.uploadId) || !body.patch) return json({ error: "חסרים נתונים להחלה." }, 400);
      // caseId: מפורש מה-body (לשוניות מרובות) קודם; עוגייה כגיבוי תאימות.
      const store = await cookies();
      const caseId = (isUuid(body.caseId) ? body.caseId : null) ?? (store.get("strauss_case")?.value ?? null);
      if (!isUuid(caseId)) return json({ error: "אין תיק פעיל." }, 400);

      const cur = await service.getCaseState(caseId, owner);
      if (!cur) return json({ error: "התיק לא נמצא." }, 404);
      // אטומי: סימון applied + עדכון עובדות בטרנזקציה אחת. כשל/קונפליקט מגלגל
      // אחורה את שניהם - לא נשאר חילוץ מסומן "הוחל" בלי עדכון. null לא נשלח ולא דורס.
      const res = await service.applyPayslip(caseId, owner, body.uploadId, body.patch, cur.case.factsRevision);
      if (res.status === "already_applied") {
        return json({ status: "already_applied", caseId });
      }
      if (res.status === "conflict") {
        return json({ status: "conflict", message: "הנתונים השתנו בינתיים; רענן/י ונסה/י שוב." }, 409);
      }
      return json({ status: "applied", caseId });
    }

    if (action === "discard") {
      const body = (await req.json().catch(() => ({}))) as { uploadId?: string };
      if (isUuid(body.uploadId)) await discardPayslip({ connectionString: conn, ownerId: owner, uploadId: body.uploadId }).catch(() => {});
      return json({ status: "discarded" });
    }

    return json({ error: "פעולה לא מוכרת." }, 400);
  } catch (e) {
    // ערך לא תקין בהחלה: הודעה עברית ברורה (לא טקסט פנימי).
    if (e instanceof InvalidFactsError) return json({ error: e.message, kind: "invalid" }, 400);
    // שגיאה פנימית: לוג בשרת בלבד. שמות טבלאות/נתיבים/הגדרות אינם חוזרים ללקוח.
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error(`[payslip] failed: ${msg.replace(/postgres(ql)?:\/\/\S+/gi, "postgres://***").replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***").slice(0, 300)}`);
    return json({ error: "אירעה תקלה בעיבוד הבקשה. אפשר לנסות שוב בעוד רגע." }, 500);
  }
}