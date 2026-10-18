// src/app/auth-actions.ts
"use server";
// פעולות התחברות בצד שרת: שליחת קוד חד-פעמי למייל, אימות הקוד, ויציאה.
// ללא סיסמה וללא הרשמה נפרדת: הקוד הראשון יוצר את החשבון (shouldCreateUser).
// הודעות שגיאה אחידות: לא חושפים אם כתובת קיימת. הגבלת קצב נוספת מעל זו של Supabase.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAuthClient, AuthConfigError } from "../server/auth/supabase.js";
import { nextCookieAdapter } from "../server/auth/next-session.js";
import { checkRateLimit } from "../server/web/rate-limit.js";
import { normalizeEmail, normalizeCode } from "../server/auth/validate.js";

export type OtpRequestResult =
  | { status: "sent" }
  | { status: "invalid_email" }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "unavailable"; message: string };

export type OtpVerifyResult =
  | { status: "ok" }
  | { status: "invalid_code" }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "unavailable"; message: string };


/** שולח קוד כניסה למייל. תמיד אותה תשובה "נשלח" כשהכתובת תקינה (בלי חשיפת קיום). */
export async function requestOtp(emailRaw: string): Promise<OtpRequestResult> {
  const email = normalizeEmail(emailRaw);
  if (!email) return { status: "invalid_email" };
  // חלון קצר לכל כתובת: מונע הצפת תיבת הדואר ושרפת מכסת שליחה.
  const rl = checkRateLimit(`otp-send:${email}`, 3, 10 * 60_000);
  if (!rl.allowed) return { status: "rate_limited", retryAfterSeconds: rl.retryAfterSeconds };
  try {
    const client = createAuthClient(await nextCookieAdapter());
    const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) {
      const status = (error as { status?: number }).status;
      if (status === 429) return { status: "rate_limited", retryAfterSeconds: 60 };
      console.warn(`[auth] otp send failed: status=${status ?? "?"} code=${(error as { code?: string }).code ?? "?"}`);
      return { status: "unavailable", message: "לא הצלחנו לשלוח קוד כרגע. נסו שוב בעוד רגע." };
    }
    return { status: "sent" };
  } catch (e) {
    if (e instanceof AuthConfigError) return { status: "unavailable", message: "ההתחברות עדיין לא הוגדרה בשרת." };
    console.warn(`[auth] otp send error: ${e instanceof Error ? e.name : "Error"}`);
    return { status: "unavailable", message: "לא הצלחנו לשלוח קוד כרגע. נסו שוב בעוד רגע." };
  }
}

/** מאמת קוד. הצלחה: עוגיות הסשן נכתבות (httpOnly) ועוברים לבירורים. */
export async function verifyOtp(emailRaw: string, codeRaw: string): Promise<OtpVerifyResult> {
  const email = normalizeEmail(emailRaw);
  const code = normalizeCode(codeRaw);
  if (!email || !code) return { status: "invalid_code" };
  // ניחוש קוד: עד 8 ניסיונות ל-10 דקות לכל כתובת.
  const rl = checkRateLimit(`otp-verify:${email}`, 8, 10 * 60_000);
  if (!rl.allowed) return { status: "rate_limited", retryAfterSeconds: rl.retryAfterSeconds };
  try {
    const client = createAuthClient(await nextCookieAdapter());
    const { data, error } = await client.auth.verifyOtp({ email, token: code, type: "email" });
    if (error || !data.session) return { status: "invalid_code" };
  } catch (e) {
    if (e instanceof AuthConfigError) return { status: "unavailable", message: "ההתחברות עדיין לא הוגדרה בשרת." };
    return { status: "invalid_code" };
  }
  // כניסה חדשה = התחלה נקייה: לא יורשים מצביע תיק או עוגיית ביקור ישנה.
  const store = await cookies();
  store.delete("strauss_case");
  store.delete("strauss_visit");
  redirect("/inquiries");
}

/** יציאה והחלפת חשבון: מסיימת את הסשן ומנקה כל מצביע למשתמש הקודם. */
export async function signOut(): Promise<void> {
  try {
    const client = createAuthClient(await nextCookieAdapter());
    await client.auth.signOut();
  } catch {
    // גם אם הקריאה נכשלה, מנקים עוגיות מקומית בהמשך.
  }
  const store = await cookies();
  for (const c of store.getAll()) {
    if (c.name.startsWith("sb-") || c.name === "strauss_case" || c.name === "strauss_visit") store.delete(c.name);
  }
  redirect("/login");
}