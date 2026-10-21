// src/server/auth/return-path.ts
// נתיב חזרה אחרי התחברות (למשל קישור ההתראה /go/case/<id>). הנתיב נשמר בעוגיית
// httpOnly קצרת-חיים ע"י ה-middleware ונצרך ב-verifyOtp. רשימת היתרים סגורה בלבד:
// אין redirect פתוח, ואין נתיב שמגיע ישירות מפרמטר שהלקוח שולט בו. פונקציה טהורה
// (בלי next/headers) כדי שתרוץ גם ב-middleware וגם בבדיקות.

export const RETURN_COOKIE = "strauss_next";
export const RETURN_COOKIE_MAX_AGE_SECONDS = 15 * 60;

const ALLOWED: RegExp[] = [
  /^\/go\/case\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^\/representative$/,
];

/** מחזיר נתיב בטוח לחזרה (path בלבד, בלי query), או null אם אינו ברשימת ההיתרים. */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v.length === 0 || v.length > 200) return null;
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\") || /[\r\n\t]/.test(v)) return null;
  const pathOnly = v.split(/[?#]/)[0]!;
  return ALLOWED.some((re) => re.test(pathOnly)) ? pathOnly : null;
}
