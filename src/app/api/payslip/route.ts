// src/app/api/payslip/route.ts
// זרימת תלוש מקצה לקצה. זהות הבעלים מה-cookie בלבד.
//   POST ?action=upload   (ברירת מחדל): ולידציה + אחסון פרטי + סימון בהיסטוריה. חינם.
//   POST ?action=extract  : חילוץ בעזרת המודל (בתשלום). שומר על השורה לשחזור.
//   POST ?action=apply    : החלה על התיק (אידמפוטנטי - לא מחיל פעמיים). חינם.
//   GET  ?pending=1        : חילוץ שממתין לאישור בתיק הפעיל (לשחזור אחרי רענון).
// תוכן המסמך = נתונים בלבד; אינו נכנס להקשר השיחה. ההיסטוריה מראה רק "הועלה מסמך".

import { cookies } from "next/headers";
import { caseService } from "../../../server/web/service.js";
import { getOrCreateVisitOwner } from "../../../server/web/visit.js";
import {
  validatePayslip, storePayslip, readPayslipBytes,
  saveExtraction, markApplied, discardPayslip, loadPendingExtraction,
} from "../../../server/web/payslip-storage.js";
import { extractPayslip, type PayslipExtraction } from "../../../server/agent/payslip-extract.js";

export const runtime = "nodejs";
export const maxDuration = 60;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function activeCaseId(owner: string): Promise<string> {
  const store = await cookies();
  let caseId = store.get("strauss_case")?.value ?? null;
  const service = caseService();
  const state = caseId ? await service.getCaseState(caseId, owner) : null;
  if (!state) {
    const created = await service.startBlankCase(owner);
    caseId = created.case.id;
    store.set("strauss_case", caseId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  }
  return caseId!;
}

export async function GET(req: Request): Promise<Response> {
  const owner = await getOrCreateVisitOwner();
  const conn = process.env.DATABASE_URL;
  if (!conn) return json({ pending: null });
  const url = new URL(req.url);
  if (url.searchParams.get("pending") !== "1") return json({ pending: null });
  const store = await cookies();
  const caseId = store.get("strauss_case")?.value ?? null;
  if (!caseId) return json({ pending: null });
  const pend = await loadPendingExtraction({ connectionString: conn, ownerId: owner, caseId }).catch(() => null);
  return json({ pending: pend });
}

export async function POST(req: Request): Promise<Response> {
  const owner = await getOrCreateVisitOwner();
  const conn = process.env.DATABASE_URL;
  if (!conn) return json({ error: "אחסון לא זמין בסביבה זו." }, 503);
  const service = caseService();
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "upload";

  try {
    if (action === "upload") {
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
      if (!body.uploadId) return json({ error: "חסר מזהה העלאה." }, 400);
      const file = await readPayslipBytes({ connectionString: conn, ownerId: owner, uploadId: body.uploadId });
      if (!file) return json({ error: "הקובץ לא נמצא או אינו שייך לך." }, 404);
      let extraction: PayslipExtraction;
      try {
        extraction = await extractPayslip(file.bytes, file.mime);
      } catch (e) {
        await discardPayslip({ connectionString: conn, ownerId: owner, uploadId: body.uploadId }).catch(() => {});
        const m = e instanceof Error ? e.message : String(e);
        return json({ error: "לא הצלחתי לקרוא את המסמך. נסו קובץ ברור יותר או הזנה ידנית.", detail: m.slice(0, 120) }, 422);
      }
      await saveExtraction({ connectionString: conn, ownerId: owner, uploadId: body.uploadId, extraction }).catch(() => {});
      return json({ status: "extracted", uploadId: body.uploadId, extraction });
    }

    if (action === "apply") {
      const body = (await req.json().catch(() => ({}))) as { uploadId?: string; patch?: Record<string, number | null> };
      if (!body.uploadId || !body.patch) return json({ error: "חסרים נתונים להחלה." }, 400);
      const store = await cookies();
      const caseId = store.get("strauss_case")?.value ?? null;
      if (!caseId) return json({ error: "אין תיק פעיל." }, 400);

      // אידמפוטנטיות: מסמנים applied אטומית; אם כבר הוחל - לא מחילים שוב.
      const first = await markApplied({ connectionString: conn, ownerId: owner, uploadId: body.uploadId });
      if (!first) return json({ status: "already_applied" });

      const cur = await service.getCaseState(caseId, owner);
      if (!cur) return json({ error: "התיק לא נמצא." }, 404);
      // רק שדות עם ערך (כולל 0 מפורש) מוחלים; null לא נשלח מהלקוח ולא דורס.
      const res = await service.updateFacts(caseId, owner, body.patch, cur.case.factsRevision);
      if (res.status === "conflict") {
        return json({ status: "conflict", message: "הנתונים השתנו בינתיים; רענן/י ונסה/י שוב." }, 409);
      }
      const after = await service.getCaseState(caseId, owner);
      return json({ status: "applied", facts: after?.facts ?? null });
    }

    if (action === "discard") {
      const body = (await req.json().catch(() => ({}))) as { uploadId?: string };
      if (body.uploadId) await discardPayslip({ connectionString: conn, ownerId: owner, uploadId: body.uploadId }).catch(() => {});
      return json({ status: "discarded" });
    }

    return json({ error: "פעולה לא מוכרת." }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const safe = msg.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***");
    return json({ error: safe }, 500);
  }
}