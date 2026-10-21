// src/app/api/worker/notifications/route.ts
// נקודת עיבוד תור ההתראות. מופעלת ע"י Vercel Cron (או קריאה ידנית מורשית).
// הגנה: דורש כותרת Authorization: Bearer <CRON_SECRET> (Vercel Cron שולח אותה
// אוטומטית כש-CRON_SECRET מוגדר). אין כאן מידע משתמש בתגובה - רק מונים.
import { createHash, timingSafeEqual } from "node:crypto";
import { processNotifications } from "../../../../server/notify/worker.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  // בלי CRON_SECRET מוגדר: חוסמים (לא מאפשרים הפעלה פתוחה בפרודקשן).
  if (!secret) return false;
  const h = req.headers.get("authorization") ?? "";
  // השוואה בזמן קבוע (על גיבובים באורך זהה) - ללא מידע דרך זמן תגובה.
  const a = createHash("sha256").update(h).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  }
  try {
    const res = await processNotifications();
    return new Response(JSON.stringify(res), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : "error").slice(0, 150);
    console.error("[notify-worker] " + msg);
    return new Response(JSON.stringify({ error: "worker_error" }), { status: 500, headers: { "content-type": "application/json" } });
  }
}

// Vercel Cron שולח GET; תומכים גם ב-POST להפעלה ידנית מורשית.
export const GET = handle;
export const POST = handle;