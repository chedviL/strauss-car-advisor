// src/domain/ids.ts
// מזהה UUID קפדני. הביטוי הישן /^[0-9a-f-]{36}$/ קיבל 36 מקפים או כל ערבוב של hex/מקף,
// ו-Postgres זרק "invalid input syntax for type uuid" -> 500 במקום 404/400.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}
