// src/app/api/transcribe/route.ts
// תמלול דיבור לטקסט עבור הקומפוזר. זהות הבעלים מהסשן בלבד.
//   GET  : האם התכונה זמינה (קיים מפתח ספק) - כדי שהממשק לא יציג כפתור מושבת.
//   POST : מקבל הקלטה (multipart "audio") ומחזיר { text }.
//
// האודיו *אינו נשמר*: הוא עובר בזיכרון לספק התמלול וההקלטה נזרקת. רק הטקסט
// חוזר ללקוח, נכנס לתיבת הטקסט לעריכה, ונשמר בהיסטוריה רק אם נשלח כהודעה.

import { getSessionUser } from "../../../server/auth/next-session.js";
import { checkRateLimit } from "../../../server/web/rate-limit.js";
import {
  transcribeAudio, transcribeEnabled,
  ALLOWED_AUDIO_MIMES, MAX_AUDIO_BYTES,
  TranscribeQuotaError, TranscribeUnavailable, TranscribeUnreadable,
  type AllowedAudioMime,
} from "../../../server/agent/transcribe.js";

export const runtime = "nodejs";
export const maxDuration = 60;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** מנרמל content-type של Blob ("audio/webm;codecs=opus" -> "audio/webm"). */
function baseMime(raw: string): string {
  return (raw.split(";")[0] ?? "").trim().toLowerCase();
}

export async function GET(): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ error: "auth_required" }, 401);
  return json({ available: transcribeEnabled() });
}

export async function POST(req: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ error: "auth_required" }, 401);
  const owner = user.id;

  if (!transcribeEnabled()) {
    return json({ error: "הדיבור אינו זמין בסביבה זו. אפשר להקליד.", kind: "unavailable" }, 503);
  }

  // הגבלת קצב: עד 15 פעמים לדקה לכל בעלים (קטעים קצרים, שימוש תכוף סביר).
  const rl = checkRateLimit(`transcribe:${owner}`, 15, 60_000);
  if (!rl.allowed) {
    return json({
      error: "יותר מדי פעמים בזמן קצר. נסה שוב בעוד רגע.",
      kind: "rate_limit", retryAfterSeconds: rl.retryAfterSeconds,
    }, 429);
  }

  let file: File;
  try {
    const form = await req.formData();
    const f = form.get("audio");
    if (!(f instanceof File)) return json({ error: "לא התקבל קול. נסה שוב.", kind: "bad_request" }, 400);
    file = f;
  } catch {
    return json({ error: "בקשה שגויה.", kind: "bad_request" }, 400);
  }

  const mime = baseMime(file.type);
  if (!(ALLOWED_AUDIO_MIMES as readonly string[]).includes(mime)) {
    return json({ error: "פורמט הקול אינו נתמך.", kind: "bad_request" }, 400);
  }
  if (file.size === 0) {
    return json({ error: "לא שמעתי כלום. נסה שוב.", kind: "empty" }, 400);
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return json({ error: "הדיבור ארוך מדי. אפשר לדבר בקטעים קצרים יותר.", kind: "too_large" }, 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const text = await transcribeAudio(bytes, mime as AllowedAudioMime);
    if (text === "") {
      return json({ error: "לא שמעתי דיבור. נסה שוב או הקלד.", kind: "empty" }, 422);
    }
    return json({ text });
  } catch (e) {
    if (e instanceof TranscribeQuotaError) {
      return json({
        error: e.retryAfterSeconds
          ? `מכסת הדיבור נוצלה כרגע. אפשר לנסות שוב בעוד כ-${Math.ceil(e.retryAfterSeconds / 60)} דקות, או להקליד.`
          : "מכסת הדיבור נוצלה כרגע. אפשר לנסות שוב מאוחר יותר, או להקליד.",
        kind: "quota", retryAfterSeconds: e.retryAfterSeconds, canRetry: true,
      }, 429);
    }
    if (e instanceof TranscribeUnavailable) {
      return json({ error: "הדיבור אינו זמין כרגע. אפשר להקליד.", kind: "unavailable" }, 503);
    }
    if (e instanceof TranscribeUnreadable) {
      return json({
        error: "לא הצלחתי להבין. נסה שוב בסביבה שקטה, או הקלד.",
        kind: "unreadable", canRetry: true,
      }, 422);
    }
    const m = e instanceof Error ? e.message : String(e);
    console.warn(`[transcribe] failed: ${m.replace(/gsk_[A-Za-z0-9_-]{8,}/g, "gsk_***").slice(0, 200)}`);
    return json({ error: "לא הצלחתי להבין. אפשר לנסות שוב או להקליד.", kind: "error", canRetry: true }, 500);
  }
}
