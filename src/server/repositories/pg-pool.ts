// src/server/repositories/pg-pool.ts
// Pool משותף יחיד per-process per-connection-string.
// מכוון ל-Supabase Session Pooler (port 5432) - הפורט הזמין בפרויקט זה
// (ה-Transaction Pooler בפורט 6543 אינו נגיש כאן). חיבורי session יציבים,
// לכן שומרים אותם חמים זמן ארוך כדי לחסוך TLS handshake יקר חוזר.
// מטפל בשגיאות pool + retry (withClient) למקרה שחיבור idle נסגר.

import { Pool, type PoolClient } from "pg";
import { sslFor } from "./pg-ssl.js";

const pools = new Map<string, Pool>();

export function getPool(connectionString: string): Pool {
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 10,
      keepAlive: true,
      // חיבורי session יציבים: שומרים חמים דקות כדי לחסוך handshake חוזר.
      idleTimeoutMillis: 300_000,
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