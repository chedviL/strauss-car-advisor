// src/server/repositories/pg-ssl.ts
// הגדרת SSL ל-pg. Supabase (pooler/direct) מחייב TLS. חיבור מקומי (localhost) - ללא SSL.
// לא מדפיס ולא חושף סודות; מקבל רק את מחרוזת החיבור ומחליט לפי המארח.

export interface PgSslConfig {
  ssl?: { rejectUnauthorized: boolean } | undefined;
}

export function sslFor(connectionString: string): PgSslConfig {
  let host = "";
  try {
    host = new URL(connectionString).hostname;
  } catch {
    host = "";
  }
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "";
  if (isLocal) return {};
  // Supabase: TLS נדרש. אימות ה-CA של ה-pooler אינו ב-bundle ברירת המחדל,
  // לכן rejectUnauthorized=false (הצפנה בתעבורה; לא מאמת שרשרת CA).
  return { ssl: { rejectUnauthorized: false } };
}