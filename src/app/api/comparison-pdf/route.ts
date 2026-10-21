// src/app/api/comparison-pdf/route.ts
// הורדת סיכום ההשוואה כ-PDF. זהות הבעלים מהסשן בלבד.
//   GET ?c=<caseId>&cmp=<comparisonId>
//
// האבטחה (המסמך מכיל נתוני שכר):
//  - סשן חובה (401). הבעלות נאכפת דרך getCaseState(caseId, owner) => RLS; תיק של
//    אחר מחזיר 404 בלי לחשוף שהוא קיים.
//  - cmp (אופציונלי, אבל הלקוח תמיד שולח): מזהה ההשוואה שהמשתמש/ת רואה על המסך. אם
//    בינתיים חושבה השוואה חדשה - 409, כדי שלא יורד PDF עם מספרים שונים ממה שבכרטיס.
//  - הסכומים מגיעים מההשוואה השמורה בלבד (פלט המנוע); שום חישוב כאן.
//  - המסמך נוצר בזיכרון ומוחזר; לא נשמר בדיסק/אחסון. Cache-Control: no-store.
//  - לוגים: ללא תוכן המסמך וללא סכומים.

import { getSessionUser } from "../../../server/auth/next-session.js";
import { caseService } from "../../../server/web/service.js";
import { checkRateLimit } from "../../../server/web/rate-limit.js";
import { buildComparisonPdfModel } from "../../../server/pdf/comparison-model.js";
import { renderComparisonPdf } from "../../../server/pdf/comparison-pdf.js";

export const runtime = "nodejs";
export const maxDuration = 30;

import { UUID_RE } from "../../../domain/ids.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function GET(req: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ error: "auth_required" }, 401);
  const owner = user.id;

  // יצירת PDF היא עבודה חישובית קטנה; עדיין מגבילים כדי לא לאפשר לולאת בקשות.
  const rl = checkRateLimit(`comparison-pdf:${owner}`, 10, 60_000);
  if (!rl.allowed) {
    return json({
      error: "יותר מדי הורדות בזמן קצר. נסה שוב בעוד רגע.",
      kind: "rate_limit", retryAfterSeconds: rl.retryAfterSeconds,
    }, 429);
  }

  const url = new URL(req.url);
  const caseId = (url.searchParams.get("c") ?? "").trim();
  const cmpId = (url.searchParams.get("cmp") ?? "").trim();
  if (!UUID_RE.test(caseId) || (cmpId !== "" && !UUID_RE.test(cmpId))) {
    return json({ error: "בקשה שגויה.", kind: "bad_request" }, 400);
  }

  try {
    const service = caseService();
    const state = await service.getCaseState(caseId, owner);
    if (!state) return json({ error: "ההשוואה לא נמצאה.", kind: "not_found" }, 404);

    if (cmpId !== "" && state.latestComparison?.id !== cmpId) {
      return json({
        error: "ההשוואה התעדכנה מאז שנפתח המסך. רענן את העמוד והורד שוב, כדי שהמסמך יתאים למה שמוצג.",
        kind: "stale",
      }, 409);
    }

    const names = await service.vehicleNames();
    const built = buildComparisonPdfModel(state, names);
    if (!built.ok) {
      const status = built.reason === "no_comparison" ? 404 : 422;
      return json({ error: built.message, kind: built.reason }, status);
    }

    const { bytes, unsupported } = await renderComparisonPdf(built.model);
    if (unsupported.length > 0) {
      // מדווחים רק כמות: התווים עצמם הם חלק מנתוני המשתמש/ת.
      console.warn(`[comparison-pdf] ${unsupported.length} unsupported character(s) dropped from output`);
    }

    // עותק מפורש ל-Uint8Array מעל ArrayBuffer רגיל (נדרש כ-BodyInit בטיפוסי TS עדכניים).
    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);

    const niceName = `השוואת-נטו-שטראוס-${built.model.generatedAtLabel}.pdf`;
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        // שם ASCII לגיבוי + שם עברי בקידוד RFC 5987.
        "content-disposition": `attachment; filename="strauss-net-comparison.pdf"; filename*=UTF-8''${encodeURIComponent(niceName)}`,
        "content-length": String(body.byteLength),
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error(`[comparison-pdf] failed: ${m.replace(/postgres(ql)?:\/\/\S+/gi, "postgres://***").slice(0, 200)}`);
    return json({ error: "יצירת המסמך נכשלה. אפשר לנסות שוב בעוד רגע.", kind: "error", canRetry: true }, 500);
  }
}
