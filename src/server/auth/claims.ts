// src/server/auth/claims.ts
// אימות סשן מתוך ה-JWT של Supabase Auth. getClaims() מאמת חתימה ותוקף מול
// מפתחות ה-JWKS של הפרויקט (ES256, ללא קריאת רשת בכל בקשה), ולכן לא פוגע במהירות
// השיחה. אין שימוש ב-getSession() להרשאה: הערך בעוגיה אינו אמין עד אימות החתימה.
// אין תלות ב-Next/pg: המודול משמש גם את ה-middleware (edge).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface SessionUser {
  /** מזהה משתמש Supabase (uuid). זהו ה-owner_id בכל טבלאות ה-RLS. */
  id: string;
  email: string | null;
}

/**
 * מחזיר את המשתמש המאומת מתוך הלקוח, או null.
 * דוחה: טוקן לא תקף/פג, משתמש אנונימי, ותפקיד שאינו authenticated.
 */
export async function userFromClient(client: SupabaseClient): Promise<SessionUser | null> {
  const { data, error } = await client.auth.getClaims();
  if (error || !data) return null;
  const c = data.claims as unknown as Record<string, unknown>;
  const sub = typeof c.sub === "string" ? c.sub : "";
  if (!sub) return null;
  if (c.is_anonymous === true) return null;
  if (c.role !== "authenticated") return null;
  return { id: sub, email: typeof c.email === "string" ? c.email : null };
}