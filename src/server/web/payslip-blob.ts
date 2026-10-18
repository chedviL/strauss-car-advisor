// src/server/web/payslip-blob.ts
// שכבת אחסון הבייטים של התלוש, עם שני backends:
//   local    - דיסק שרת פרטי (data/uploads) לפיתוח בלבד.
//   supabase - Supabase Storage (bucket פרטי) לפריסה, כך שלא נשארים תלושים
//              על דיסק מקומי. נבחר אוטומטית כש-SUPABASE_URL + SERVICE_ROLE_KEY מוגדרים.
// בדיקת הבעלות מתבצעת בשכבת המטא-דאטה (RLS) לפני כל קריאה/כתיבה/מחיקה כאן;
// ה-backend מקבל נתיב אטום (ownerDir/storedKey) ואינו יודע זהויות.

import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

export type StorageBackend = "local" | "supabase";
const BUCKET = "payslips"; // bucket פרטי ב-Supabase Storage
const UPLOAD_ROOT = resolve(process.cwd(), "data", "uploads");

/** כשל-הגדרת אחסון: חסרים משתני Supabase בסביבה פרוסה (אין מעבר שקט לדיסק). */
export class StorageConfigError extends Error {}

/**
 * איזה backend פעיל, עם אותה דיסציפלינה כמו בחירת ה-repository:
 * - SUPABASE_URL + SERVICE_ROLE_KEY מוגדרים → supabase (מסלול הפריסה).
 * - חסרים, אך STRAUSS_ALLOW_FILE_STORE=1 → local (אופציה מקומית מפורשת, פיתוח).
 * - חסרים, ו-DATABASE_URL מוגדר (סביבה פרוסה/Postgres) → שגיאת הגדרה ברורה.
 *   *אין מעבר שקט לדיסק מקומי* כשהאפליקציה רצה מול Postgres.
 * - חסרים, ואין DATABASE_URL (פיתוח מקומי טהור) → local.
 */
export function activeBackend(): StorageBackend {
  // הסכמה מקומית מפורשת: STRAUSS_ALLOW_FILE_STORE=1 מכריח אחסון מקומי
  // (פיתוח/בדיקות בלבד), וגובר על Supabase. *אסור בפרודקשן* - שם הדגל נכשל
  // בבירור כדי שלא יישמרו תלושי משתמשים על דיסק מקומי בטעות.
  if (process.env.STRAUSS_ALLOW_FILE_STORE === "1") {
    if (process.env.NODE_ENV === "production") {
      throw new StorageConfigError(
        "STRAUSS_ALLOW_FILE_STORE=1 אסור בפרודקשן: אחסון מקומי מיועד לפיתוח/בדיקות בלבד. " +
          "בפרודקשן הגדירו SUPABASE_URL ו-SUPABASE_SERVICE_ROLE_KEY. ראו docs/supabase-setup.md.",
      );
    }
    return "local";
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && url.trim() && key && key.trim()) return "supabase";

  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && dbUrl.trim() !== "") {
    throw new StorageConfigError(
      "אחסון התלושים אינו מוגדר: חסרים SUPABASE_URL ו-SUPABASE_SERVICE_ROLE_KEY. " +
        "בסביבה פרוסה (DATABASE_URL מוגדר) חובה אחסון פרטי ב-Supabase Storage; " +
        "אין מעבר שקט לדיסק מקומי. לפיתוח מקומי בלבד אפשר STRAUSS_ALLOW_FILE_STORE=1. " +
        "ראו docs/supabase-setup.md.",
    );
  }
  return "local";
}

/** נתיב אטום לאובייקט: hash(owner)/storedKey. אין בו זהות קריאה. */
export function objectPath(ownerId: string, storedKey: string): string {
  const ownerDir = createHash("sha256").update(ownerId).digest("hex").slice(0, 32);
  return `${ownerDir}/${storedKey}`;
}

/**
 * מנרמל ומאמת את SUPABASE_URL: חייב להיות ה-URL של הפרויקט (https://<ref>.supabase.co),
 * ללא נתיב וללא סלאש בסוף. כתובת לוח-הבקרה (supabase.com/dashboard/...) או http
 * גורמים לשרת להחזיר HTML במקום JSON ("Unexpected token '<'"); עדיף כשל ברור מוקדם.
 * אין הדפסת הערך עצמו.
 */
export function resolveSupabaseUrl(): string {
  const raw = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  let host = "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") throw new Error("scheme");
    if (u.pathname && u.pathname !== "/") throw new Error("path");
    host = u.host;
  } catch {
    throw new StorageConfigError(
      "SUPABASE_URL אינו תקין. נדרש ה-URL של הפרויקט בלבד, בצורה " +
        "https://<project-ref>.supabase.co (ללא http, ללא נתיב, ללא / בסוף). " +
        "אין להשתמש בכתובת לוח הבקרה (supabase.com/dashboard/...). ראו docs/supabase-setup.md.",
    );
  }
  if (!/\.supabase\.(co|in|net)$/.test(host)) {
    throw new StorageConfigError(
      "SUPABASE_URL אינו מצביע על דומיין Supabase תקין (…​.supabase.co). " +
        "העתיקו את 'Project URL' מ-Project Settings > API. ראו docs/supabase-setup.md.",
    );
  }
  return raw;
}

// --- Supabase Storage client (service role; צד שרת בלבד) ---
async function supa() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(resolveSupabaseUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** כתיבת הבייטים ל-backend הפעיל. מחזיר את ה-backend שבו נשמר. */
export async function putBlob(ownerId: string, storedKey: string, bytes: Uint8Array, mime: string): Promise<StorageBackend> {
  const path = objectPath(ownerId, storedKey);
  if (activeBackend() === "supabase") {
    const client = await supa();
    const { error } = await client.storage.from(BUCKET).upload(path, Buffer.from(bytes), {
      contentType: mime, upsert: false,
    });
    if (error) throw new Error("supabase upload failed: " + error.message);
    return "supabase";
  }
  const dir = join(UPLOAD_ROOT, path.split("/")[0]!);
  await mkdir(dir, { recursive: true });
  await writeFile(join(UPLOAD_ROOT, path), Buffer.from(bytes), { mode: 0o600 });
  return "local";
}

/** קריאת הבייטים לפי ה-backend שבו נשמרו (storage_backend מהמטא-דאטה). */
export async function getBlob(backend: StorageBackend, ownerId: string, storedKey: string): Promise<Buffer> {
  const path = objectPath(ownerId, storedKey);
  if (backend === "supabase") {
    const client = await supa();
    const { data, error } = await client.storage.from(BUCKET).download(path);
    if (error || !data) throw new Error("supabase download failed: " + (error?.message ?? "no data"));
    return Buffer.from(await data.arrayBuffer());
  }
  return readFile(join(UPLOAD_ROOT, path));
}

/** מחיקת הבייטים (בעת discard/ניקוי). אינו מפיל אם כבר אינו קיים. */
export async function deleteBlob(backend: StorageBackend, ownerId: string, storedKey: string): Promise<void> {
  const path = objectPath(ownerId, storedKey);
  if (backend === "supabase") {
    const client = await supa();
    await client.storage.from(BUCKET).remove([path]).catch(() => {});
    return;
  }
  await unlink(join(UPLOAD_ROOT, path)).catch(() => {});
}