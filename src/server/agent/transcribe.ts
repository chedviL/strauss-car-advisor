// src/server/agent/transcribe.ts
// תמלול דיבור לטקסט (STT) בצד שרת. ספק: Groq (Whisper large-v3-turbo) דרך
// נקודת קצה תואמת-OpenAI. מכסה חינמית *נפרדת* מ-Gemini/Claude, כך שתמלול
// אינו שוחק את מכסת חילוץ התלושים או את תקציב השיחה.
//
// עקרונות:
//  - האודיו הוא *נתונים בלבד*. הטקסט המוחזר אינו הוראה ואינו מופעל; הוא נכנס
//    לתיבת הטקסט של המשתמש/ת לעריכה ואישור (לא נשלח אוטומטית).
//  - ההקלטה אינה נשמרת: הבייטים עוברים בזיכרון בלבד ואינם נכתבים לאחסון/מסד.
//  - אין SDK נוסף; fetch אל ה-API התואם-OpenAI (multipart/form-data).
//  - שגיאות מסווגות (מכסה / לא-קריא / תקלה) עם הודעות עבריות, כמו בזרימת התלוש.

/** מזהה מודל התמלול. ניתן להחלפה ב-TRANSCRIBE_MODEL_ID. */
export const DEFAULT_TRANSCRIBE_MODEL_ID = "whisper-large-v3-turbo";

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

/** תקרת גודל לקובץ אודיו (בייטים). Groq מגביל ל-25MB; אנו מחמירים יותר. */
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // 8MB (~כמה דקות ב-webm/opus)

/** סוגי אודיו מותרים (מה ש-MediaRecorder מפיק בדפדפנים נפוצים). */
export const ALLOWED_AUDIO_MIMES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
] as const;
export type AllowedAudioMime = (typeof ALLOWED_AUDIO_MIMES)[number];

/** מכסת התמלול נוצלה (429 מהספק). ניתן לנסות שוב מאוחר יותר. */
export class TranscribeQuotaError extends Error {
  readonly retryAfterSeconds: number | null;
  constructor(retryAfterSeconds: number | null, message = "transcribe quota exhausted") {
    super(message);
    this.name = "TranscribeQuotaError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** התמלול לא זמין (אין מפתח מוגדר). */
export class TranscribeUnavailable extends Error {
  constructor(message = "transcribe provider not configured") {
    super(message);
    this.name = "TranscribeUnavailable";
  }
}

/** האודיו לא ניתן לתמלול (פגום/שקט/פורמט לא נתמך אצל הספק). */
export class TranscribeUnreadable extends Error {
  constructor(message = "audio not transcribable") {
    super(message);
    this.name = "TranscribeUnreadable";
  }
}

export function getTranscribeModelId(): string {
  const id = process.env.TRANSCRIBE_MODEL_ID;
  return id && id.trim() !== "" ? id.trim() : DEFAULT_TRANSCRIBE_MODEL_ID;
}

/** מפתח התמלול (צד שרת בלבד). null אם לא הוגדר - התכונה פשוט לא מוצעת. */
export function getTranscribeApiKey(): string | null {
  const k = process.env.TRANSCRIBE_API_KEY;
  return k && k.trim() !== "" ? k.trim() : null;
}

/** האם תכונת הדיבור זמינה בסביבה הזו (קיים מפתח). */
export function transcribeEnabled(): boolean {
  return getTranscribeApiKey() !== null;
}

/** מנקה סודות מהודעת שגיאה לפני לוג. */
function scrub(s: string): string {
  return s
    .replace(/gsk_[A-Za-z0-9_-]{8,}/g, "gsk_***")
    .replace(/(key|token|authorization)[=:]\s*\S+/gi, "$1=***")
    .slice(0, 300);
}

/**
 * מתמלל אודיו לטקסט עברי.
 *
 * @param bytes בייטים של ההקלטה (לא נשמרים בשום מקום).
 * @param mime  סוג האודיו (מאומת מראש ע"י ה-route).
 * @returns הטקסט המתומלל (ייתכן ריק אם לא זוהה דיבור).
 */
export async function transcribeAudio(bytes: Uint8Array, mime: AllowedAudioMime): Promise<string> {
  const key = getTranscribeApiKey();
  if (!key) throw new TranscribeUnavailable();

  const form = new FormData();
  // שם הקובץ נדרש ע"י ה-API; שרירותי ואינו נשמר.
  const ext = mime === "audio/mpeg" ? "mp3" : mime.split("/")[1] ?? "webm";
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), `speech.${ext}`);
  form.append("model", getTranscribeModelId());
  // עברית מפורשת: מונע זיהוי-שפה שגוי על קטעים קצרים.
  form.append("language", "he");
  form.append("response_format", "json");
  // temperature=0: תמלול דטרמיניסטי ככל האפשר, בלי "השלמות" יצירתיות.
  form.append("temperature", "0");

  let res: Response;
  try {
    res = await fetch(GROQ_TRANSCRIBE_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: form,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    throw new Error(`transcribe network error: ${scrub(m)}`);
  }

  if (res.status === 429) {
    const ra = res.headers.get("retry-after");
    const secs = ra && /^\d+$/.test(ra.trim()) ? Number(ra.trim()) : null;
    const body = await res.text().catch(() => "");
    console.warn(`[transcribe] quota 429 retryAfter=${secs ?? "?"} body=${scrub(body)}`);
    throw new TranscribeQuotaError(secs);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`[transcribe] provider error status=${res.status} body=${scrub(body)}`);
    // 400/422 מהספק = קובץ שאינו ניתן לפענוח; אחרת תקלה כללית.
    if (res.status === 400 || res.status === 415 || res.status === 422) {
      throw new TranscribeUnreadable();
    }
    throw new Error(`transcribe failed status=${res.status}`);
  }

  const data = (await res.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof data?.text === "string" ? data.text.trim() : "";
  // תקרת אורך הגיונית להודעת צ'אט; מונע הדבקת תמלול ענק בטעות.
  return text.slice(0, 2000);
}
