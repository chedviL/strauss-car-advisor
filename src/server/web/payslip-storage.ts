// src/server/web/payslip-storage.ts
// אחסון פרטי לתלושים: ולידציית סוג/גודל, שמירת בייטים בתיקייה פרטית (לא נגיש-רשת),
// ומטא-דאטה בטבלת payslip_uploads (RLS לפי בעלות). תוכן המסמך = נתונים בלבד.
// אין להסיק נתיב מהשם המקורי; stored_key הוא מזהה אטום שנוצר בשרת.

import { randomUUID } from "node:crypto";
import { getPool } from "../repositories/pg-pool.js";
import { putBlob, getBlob, deleteBlob, type StorageBackend } from "./payslip-blob.js";

// סוגים נתמכים בלבד (PDF כולל סרוק, ותמונות). MIME + חתימת-בייטים.
export const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export type AllowedMime = (typeof ALLOWED_MIME)[number];
export const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB


export interface StoredPayslip {
  id: string;          // מזהה שורת המטא-דאטה
  storedKey: string;   // מזהה אטום לקובץ באחסון
  mime: AllowedMime;
  sizeBytes: number;
  originalName: string | null;
}

export interface ValidationError { kind: "type" | "size" | "empty"; message: string }

/** זיהוי סוג לפי חתימת-בייטים, לא לסמוך רק על ה-MIME שהלקוח שלח. */
function sniffMime(bytes: Uint8Array): AllowedMime | null {
  if (bytes.length < 4) return null;
  // %PDF
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  // JPEG FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // PNG 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  // WEBP: RIFF....WEBP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes.length > 11 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

/** ולידציה: גודל + סוג אמיתי לפי חתימה. מחזיר שגיאה או ה-MIME המאומת. */
export function validatePayslip(bytes: Uint8Array): { ok: true; mime: AllowedMime } | { ok: false; error: ValidationError } {
  if (bytes.length === 0) return { ok: false, error: { kind: "empty", message: "הקובץ ריק." } };
  if (bytes.length > MAX_SIZE_BYTES) {
    return { ok: false, error: { kind: "size", message: `הקובץ גדול מדי (מעל ${Math.round(MAX_SIZE_BYTES / 1024 / 1024)}MB).` } };
  }
  const mime = sniffMime(bytes);
  if (!mime) return { ok: false, error: { kind: "type", message: "סוג קובץ לא נתמך. יש להעלות PDF או תמונה (JPG/PNG/WEBP)." } };
  return { ok: true, mime };
}

/** שמירה פרטית: בייטים לתיקייה per-owner + שורת מטא-דאטה (RLS). */
export async function storePayslip(args: {
  connectionString: string;
  ownerId: string;
  caseId: string;
  bytes: Uint8Array;
  mime: AllowedMime;
  originalName: string | null;
}): Promise<StoredPayslip> {
  const { connectionString, ownerId, caseId, bytes, mime, originalName } = args;
  const storedKey = randomUUID();
  // כותבים קודם את הבייטים ל-backend הפעיל (local/supabase); אם נכשל - לא נוצרת שורה.
  const backend: StorageBackend = await putBlob(ownerId, storedKey, bytes, mime);

  // ה-DB נפרד מ-I/O של האחסון: מחזור החיים של ה-client מנוהל כולו ב-withOwnerTx
  // (begin/commit/release במקום אחד), כדי שלא יקרה double-release אם משהו אחרי
  // ה-commit נכשל. אם ה-DB נכשל - מנקים את ה-blob שכבר נכתב.
  try {
    const id = await withOwnerTx(connectionString, ownerId, async (client) => {
      // בדיקת בעלות בהעלאה: התיק חייב להיות של הבעלים (RLS).
      const owned = await client.query("select 1 from cases where id = $1", [caseId]);
      if (owned.rowCount === 0) throw new Error("case not found for owner");
      const r = await client.query(
        `insert into payslip_uploads (case_id, stored_key, mime, size_bytes, original_name, status, storage_backend)
         values ($1,$2,$3,$4,$5,'uploaded',$6) returning id`,
        [caseId, storedKey, mime, bytes.length, originalName, backend],
      );
      return r.rows[0].id as string;
    });
    return { id, storedKey, mime, sizeBytes: bytes.length, originalName };
  } catch (e) {
    await deleteBlob(backend, ownerId, storedKey).catch(() => { /* blob orphan cleanup best-effort */ });
    throw e;
  }
}

/** קריאת בייטים לפי מזהה-שורה, עם בדיקת בעלות (RLS). לשימוש החילוץ בלבד. */
export async function readPayslipBytes(args: {
  connectionString: string; ownerId: string; uploadId: string;
}): Promise<{ bytes: Buffer; mime: AllowedMime } | null> {
  const { connectionString, ownerId, uploadId } = args;
  // קוראים את המטא-דאטה (עם בדיקת בעלות RLS) בטרנזקציה סגורה, ורק אחריה
  // ניגשים ל-blob. כך I/O של האחסון אינו חלק ממחזור החיים של ה-client (אין
  // double-release אם ההורדה נכשלת), ובעלות עדיין נאכפת לפני כל גישה לקובץ.
  const meta = await withOwnerTx(connectionString, ownerId, async (client) => {
    const r = await client.query("select stored_key, mime, storage_backend from payslip_uploads where id = $1", [uploadId]);
    if (r.rowCount === 0) return null; // RLS: לא שייך לבעלים -> אין שורה
    return {
      storedKey: r.rows[0].stored_key as string,
      mime: r.rows[0].mime as AllowedMime,
      backend: (r.rows[0].storage_backend as StorageBackend) ?? "local",
    };
  });
  if (!meta) return null; // בדיקת בעלות בקריאה: בעלים אחר -> null, ללא גישה ל-blob
  const bytes = await getBlob(meta.backend, ownerId, meta.storedKey);
  return { bytes, mime: meta.mime };
}

/** שמירת תוצאת החילוץ על השורה (status=extracted) - לשחזור אחרי רענון. */
export async function saveExtraction(args: {
  connectionString: string; ownerId: string; uploadId: string; extraction: unknown;
}): Promise<void> {
  const { connectionString, ownerId, uploadId, extraction } = args;
  await withOwnerTx(connectionString, ownerId, async (client) => {
    await client.query(
      "update payslip_uploads set status='extracted', extraction=$2 where id=$1 and status <> 'applied'",
      [uploadId, JSON.stringify(extraction)],
    );
  });
}

/**
 * שולף חילוץ שמור לפי מזהה העלאה (אם קיים, טרם הוחל, ושייך לבעלים).
 * משמש למניעת קריאת מודל חוזרת לאותו מסמך (רענון/לחיצה כפולה).
 */
export async function loadExtractionByUpload(args: {
  connectionString: string; ownerId: string; uploadId: string;
}): Promise<unknown | null> {
  const { connectionString, ownerId, uploadId } = args;
  return await withOwnerTx(connectionString, ownerId, async (client) => {
    const r = await client.query(
      "select extraction from payslip_uploads where id=$1 and extraction is not null and applied_at is null",
      [uploadId],
    );
    if (r.rowCount === 0) return null;
    return r.rows[0].extraction;
  });
}

/**
 * סימון החלה - אטומי ומונע כפילות: מצליח רק אם applied_at עדיין null.
 * מחזיר true אם סומן כעת (ראשוני), false אם כבר הוחל (אין להחיל שוב).
 */
export async function markApplied(args: {
  connectionString: string; ownerId: string; uploadId: string;
}): Promise<boolean> {
  const { connectionString, ownerId, uploadId } = args;
  return await withOwnerTx(connectionString, ownerId, async (client) => {
    const r = await client.query(
      "update payslip_uploads set status='applied', applied_at=now() where id=$1 and applied_at is null returning id",
      [uploadId],
    );
    return (r.rowCount ?? 0) > 0;
  });
}

/** מסמן discarded ומוחק את ה-blob (ביטול/כשל). מחיקה רק לשורה ששייכת לבעלים (RLS). */
export async function discardPayslip(args: {
  connectionString: string; ownerId: string; uploadId: string;
}): Promise<void> {
  const { connectionString, ownerId, uploadId } = args;
  const toDelete = await withOwnerTx(connectionString, ownerId, async (client) => {
    // בדיקת בעלות במחיקה: UPDATE מסונן RLS; RETURNING רק אם השורה של הבעלים.
    const r = await client.query(
      "update payslip_uploads set status='discarded' where id=$1 and status <> 'applied' returning stored_key, storage_backend",
      [uploadId],
    );
    if (r.rowCount === 0) return null;
    return { storedKey: r.rows[0].stored_key as string, backend: (r.rows[0].storage_backend as StorageBackend) ?? "local" };
  });
  if (toDelete) await deleteBlob(toDelete.backend, ownerId, toDelete.storedKey).catch(() => {});
}

/**
 * חילוץ אחרון שממתין לאישור בתיק (status=extracted, applied_at is null) - לשחזור אחרי רענון.
 * מחזיר null אם אין.
 */
export async function loadPendingExtraction(args: {
  connectionString: string; ownerId: string; caseId: string;
}): Promise<{ uploadId: string; originalName: string | null; extraction: unknown } | null> {
  const { connectionString, ownerId, caseId } = args;
  return await withOwnerTx(connectionString, ownerId, async (client) => {
    const r = await client.query(
      `select id, original_name, extraction from payslip_uploads
       where case_id=$1 and status='extracted' and applied_at is null and extraction is not null
       order by created_at desc limit 1`,
      [caseId],
    );
    if (r.rowCount === 0) return null;
    return { uploadId: r.rows[0].id as string, originalName: (r.rows[0].original_name as string) ?? null, extraction: r.rows[0].extraction };
  });
}

/**
 * עוטף פעולה בטרנזקציה עם app.owner_id (RLS). מחזור חיים של ה-client מנוהל
 * כאן בלבד, עם דגל released יחיד כדי למנוע release כפול (באג שהתגלה כשפעולה
 * אחרי ה-commit, כמו גישה ל-blob, נכשלה והקוד שחרר שוב את אותו client).
 */
async function withOwnerTx<T>(connectionString: string, ownerId: string, fn: (c: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool(connectionString);
  const client = await pool.connect();
  let released = false;
  const release = (destroy?: boolean) => {
    if (released) return;
    released = true;
    client.release(destroy);
  };
  try {
    await client.query("begin");
    await client.query("select set_config('app.owner_id', $1, true)", [ownerId]);
    const out = await fn(client);
    await client.query("commit");
    release();
    return out;
  } catch (e) {
    try { await client.query("rollback"); } catch { /* ignore - חיבור אולי מת */ }
    release(true);
    throw e;
  }
}