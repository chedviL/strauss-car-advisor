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

/** איזה backend פעיל: supabase אם מוגדרים מפתחותיו, אחרת local. */
export function activeBackend(): StorageBackend {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && url.trim() && key && key.trim() ? "supabase" : "local";
}

/** נתיב אטום לאובייקט: hash(owner)/storedKey. אין בו זהות קריאה. */
export function objectPath(ownerId: string, storedKey: string): string {
  const ownerDir = createHash("sha256").update(ownerId).digest("hex").slice(0, 32);
  return `${ownerDir}/${storedKey}`;
}

// --- Supabase Storage client (service role; צד שרת בלבד) ---
async function supa() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
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