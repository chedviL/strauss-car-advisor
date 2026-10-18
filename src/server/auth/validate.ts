// src/server/auth/validate.ts
// נרמול וולידציה של קלט ההתחברות (מייל וקוד חד-פעמי). טהור, ללא תלות ב-Next.

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

/** מנרמל מייל: רווחים ואותיות קטנות. בלי תיקון דומיין אוטומטי (המשתמשת מתקנת בעצמה). */
export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return EMAIL_RE.test(e) && e.length <= 254 ? e : null;
}

/** קוד חד-פעמי: 6-10 ספרות (אורך הקוד נקבע בהגדרות Supabase). הדבקה עם רווחים/מקפים מותרת. */
export function normalizeCode(raw: string): string | null {
  const c = raw.replace(/[\s-]/g, "");
  return /^\d{6,10}$/.test(c) ? c : null;
}