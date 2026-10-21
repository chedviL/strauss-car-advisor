// src/server/repositories/pg-pool.ts
// Pool משותף יחיד per-process per-connection-string (ממוטמן ב-globalThis כדי
// לשרוד hot-reload ב-dev). מכוון ל-Supabase Session Pooler (port 5432) שמוגבל
// ל-15 clients משותפים: max נמוך + שחרור idle מהיר מונעים EMAXCONNSESSION.
// מטפל בשגיאות pool + retry (withClient) למקרה שחיבור idle נסגר.

import { Pool, type PoolClient } from "pg";
import { sslFor } from "./pg-ssl.js";

// ב-Next.js dev כל hot-reload טוען מחדש את המודול ומאפס משתני מודול. בלי מטמון
// גלובלי, כל קומפילציה הייתה יוצרת Pool חדש בעוד הישן מחזיק חיבורים פתוחים,
// עד מיצוי מכסת ה-pooler (EMAXCONNSESSION). מטמון על globalThis שורד reloads
// כך שנשאר בדיוק pool אחד לכל connection string לכל התהליך.
const globalForPools = globalThis as unknown as {
  __straussPgPools?: Map<string, Pool>;
};
const pools: Map<string, Pool> =
  globalForPools.__straussPgPools ?? (globalForPools.__straussPgPools = new Map());

// Supabase Session Pooler מוגבל ל-15 clients משותפים. שומרים max נמוך כדי
// שהאפליקציה לא תמצה את המכסה לבדה (ומשאירים אוויר לכלים/בדיקות מקומיים).
const MAX_CLIENTS = Number(process.env.PG_POOL_MAX ?? 6);

export function getPool(connectionString: string): Pool {
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: MAX_CLIENTS,
      keepAlive: true,
      // חיבורי idle משוחררים אחרי 30 שנ׳ כדי לא להחזיק חיבורים מהמכסה המשותפת
      // סתם. ה-handshake החוזר זול יחסית למול מיצוי ה-pooler.
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ...sslFor(connectionString),
    });
    // חיבור idle שנסגר בצד השרת פולט 'error' ברמת ה-pool.
    // בלי מאזין, זה קורס את התהליך; עם מאזין, pg פשוט מסיר אותו מה-pool.
    pool.on("error", () => {
      /* חיבור idle נסגר ע"י ה-pooler - pg יוציא אותו מה-pool; מתעלמים */
    });
    pools.set(connectionString, pool);
  }
  return pool;
}

export async function closeAllPools(): Promise<void> {
  for (const [, p] of pools) await p.end().catch(() => {});
  pools.clear();
}
function isConnError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /terminated|ECONNRESET|EPIPE|Connection terminated|server closed|timeout|Client has encountered a connection error/i.test(
    msg,
  );
}

/**
 * מריץ fn עם client מה-pool, עם retry על חיבור מת (ה-transaction pooler של
 * Supabase סוגר חיבורים idle). חיבור פגום מושמד (release(true)) ומנסים שוב.
 * זהו המנגנון המרכזי - כל ה-repositories משתמשים בו, בלי שכפול לוגיקה.
 */
export async function withClient<T>(
  connectionString: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getPool(connectionString);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      const result = await fn(client);
      client.release();
      return result;
    } catch (err) {
      lastErr = err;
      if (client) client.release(true);
      if (attempt < 2 && isConnError(err)) {
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}