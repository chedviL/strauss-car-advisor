// src/server/web/rate-limit.ts
// מגביל-קצב פשוט בזיכרון (per-process), לנתיבים רגישים כגון העלאת/חילוץ תלוש.
// חלון מתגלגל פשוט: עד N פעולות לכל מפתח בחלון זמן נתון. לא מתיימר להיות מבוזר -
// בפריסה מרובת-מופעים זהו קו הגנה ראשון בלבד (RLS/בעלות הם ההגנה המהותית).
// אין תלות חיצונית. אין שמירת תוכן/סודות - רק חותמות זמן לכל מפתח.

type Bucket = number[]; // חותמות זמן (ms) של פעולות בחלון
const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5000;
// חלונות שונים לאותו מפתח אינם ידועים בזמן הניקוי; שומרים מרווח ביטחון (החלון הארוך בשימוש: 15 דקות).
const MAX_WINDOW_SLACK_MS = 15 * 60_000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number; // כמה להמתין אם נחסם (0 אם מותר)
  remaining: number;
}

/**
 * בודק ומעדכן מגבלת קצב למפתח נתון. מחזיר allowed=false אם חרג.
 * @param key   מזהה לוגי (למשל `payslip-upload:<ownerId>`).
 * @param limit מספר הפעולות המותר בחלון.
 * @param windowMs אורך החלון במילישניות.
 * @param now   זמן נוכחי (להזרקה בבדיקות).
 */
export function checkRateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): RateLimitResult {
  const cutoff = now - windowMs;
  // מניעת גידול בלתי מוגבל של המפה (מפתח לכל מייל/בעלים): כשהיא גדולה, מסירים מפתחות שפגו.
  if (buckets.size > MAX_KEYS) {
    for (const [k, b] of buckets) {
      const last = b[b.length - 1];
      if (last === undefined || last <= cutoff - MAX_WINDOW_SLACK_MS) buckets.delete(k);
    }
  }
  const prev = buckets.get(key) ?? [];
  // משאירים רק פעולות בתוך החלון.
  const recent = prev.filter((t) => t > cutoff);
  if (recent.length >= limit) {
    const oldest = recent[0]!;
    const retryAfterMs = oldest + windowMs - now;
    buckets.set(key, recent);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)), remaining: 0 };
  }
  recent.push(now);
  buckets.set(key, recent);
  return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, limit - recent.length) };
}

/** איפוס (לבדיקות בלבד). */
export function __resetRateLimits(): void {
  buckets.clear();
}