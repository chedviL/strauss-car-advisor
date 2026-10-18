// src/server/auth/next-session.ts
// חיבור Supabase Auth ל-Next: מתאם עוגיות מעל next/headers + עזרי "מי המשתמש".
// זהות הבעלים נקבעת כאן בשרת בלבד, מהסשן המאומת. עוגיית הביקור הישנה
// (strauss_visit) אינה משמשת עוד להרשאה, ותיקים אנונימיים אינם משויכים אוטומטית.

import { cookies } from "next/headers";
import { authConfigured, createAuthClient, type CookieAdapter, type CookieToSet } from "./supabase.js";
import { userFromClient, type SessionUser } from "./claims.js";

export type { SessionUser };

/** נדרשת התחברות: ה-API מחזיר 401, עמודים מופנים ל-/login. */
export class AuthRequiredError extends Error {
  constructor() {
    super("auth_required");
    this.name = "AuthRequiredError";
  }
}

export async function nextCookieAdapter(): Promise<CookieAdapter> {
  const store = await cookies();
  return {
    getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    setAll: (list: CookieToSet[]) => {
      try {
        for (const { name, value, options } of list) store.set(name, value, options as never);
      } catch {
        // Server Component: עוגיות הן לקריאה בלבד. הרענון נעשה ב-middleware.
      }
    },
  };
}

/** המשתמש המאומת (אימות חתימה מקומי), או null אם אין סשן תקף / Auth לא מוגדר. */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (!authConfigured()) return null;
  const client = createAuthClient(await nextCookieAdapter());
  return await userFromClient(client);
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new AuthRequiredError();
  return u;
}

/** owner_id לשימוש בשירותים: תמיד המשתמש המאומת. */
export async function requireOwner(): Promise<string> {
  return (await requireUser()).id;
}