// src/server/auth/supabase.ts
// לקוח Supabase Auth בצד שרת בלבד (@supabase/ssr), עם מתאם עוגיות שניתן להזרקה.
// הזרקה מאפשרת לבדוק את הקוד האמיתי (כולל פיצול עוגיות הסשן) בלי Next.
// כל הזרימה (שליחת קוד, אימות, רענון, יציאה) רצה בשרת: אין NEXT_PUBLIC ואין
// קריאות Auth מהדפדפן, ולכן גם ה-CSP (connect-src 'self') אינו משתנה.

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CookieToSet { name: string; value: string; options?: Record<string, unknown> }

/**
 * ממשק עוגיות מינימלי: קריאת הכל וכתיבת אצווה. `headers` הן כותרות cache
 * (no-store) שהספרייה דורשת להחיל על התשובה כשהיא כותבת עוגיות סשן, כדי ש-CDN
 * לא ישמור תשובה עם עוגיית משתמש.
 */
export interface CookieAdapter {
  getAll(): Array<{ name: string; value: string }>;
  setAll(cookies: CookieToSet[], headers?: Record<string, string>): void;
}

/** שגיאת הגדרה: חסרים משתני סביבה של Auth. הודעה ברורה, ללא ערכים. */
export class AuthConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super("הגדרות ההתחברות חסרות בשרת: " + missing.join(", ") + ". ראו docs/auth-setup.md.");
    this.name = "AuthConfigError";
  }
}

/** משתני Auth הנדרשים. SUPABASE_ANON_KEY הוא המפתח הציבורי (publishable) בלבד. */
export function readAuthEnv(): { url: string; anonKey: string } {
  const url = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const anonKey = (process.env.SUPABASE_ANON_KEY ?? "").trim();
  const missing: string[] = [];
  if (!url) missing.push("SUPABASE_URL");
  if (!anonKey) missing.push("SUPABASE_ANON_KEY");
  if (missing.length > 0) throw new AuthConfigError(missing);
  return { url, anonKey };
}

export function authConfigured(): boolean {
  try { readAuthEnv(); return true; } catch { return false; }
}

/** יוצר לקוח Auth מעל מתאם העוגיות הנתון. */
export function createAuthClient(cookies: CookieAdapter): SupabaseClient {
  const { url, anonKey } = readAuthEnv();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (list, headers) => cookies.setAll(list as CookieToSet[], headers),
    },
    // הספרייה כופה בצד שרת: autoRefreshToken=false, detectSessionInUrl=false.
    // רענון הסשן נעשה ב-middleware; כניסה בקוד (verifyOtp) אינה תלויה ב-flowType.
  }) as unknown as SupabaseClient;
}