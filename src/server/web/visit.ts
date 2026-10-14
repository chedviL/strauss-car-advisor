// src/server/web/visit.ts
// זהות ביקור הדגמה המבודד: owner_id נגזר מ-cookie httpOnly המוזרק מהשרת.
// הלקוח לעולם אינו קובע את owner_id (מקביל ל-auth.uid() בהרשאות אמיתיות).

import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

const COOKIE = "strauss_visit";

/** מחזיר את מזהה הביקור הקיים, או יוצר אחד חדש (httpOnly, SameSite=Lax). */
export async function getOrCreateVisitOwner(): Promise<string> {
  const store = await cookies();
  const existing = store.get(COOKIE)?.value;
  if (existing) return existing;
  const id = "demo-" + randomUUID();
  store.set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return id;
}

/** קריאה בלבד - אינו יוצר ביקור חדש (לשימוש ב-Server Components בקריאת GET). */
export async function readVisitOwner(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE)?.value ?? null;
}