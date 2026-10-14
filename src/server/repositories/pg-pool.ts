// src/server/repositories/pg-pool.ts
// Pool משותף יחיד per-process per-connection-string. מונע פתיחת/סגירת pool
// (ו-TLS handshake) בכל קריאה - שיפור latency מהותי מול pooler מרוחק.

import { Pool } from "pg";
import { sslFor } from "./pg-ssl.js";

const pools = new Map<string, Pool>();

export function getPool(connectionString: string): Pool {
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new Pool({ connectionString, max: 5, ...sslFor(connectionString) });
    pools.set(connectionString, pool);
  }
  return pool;
}

export async function closeAllPools(): Promise<void> {
  for (const [, p] of pools) await p.end().catch(() => {});
  pools.clear();
}