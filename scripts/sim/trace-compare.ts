// scripts/sim/trace-compare.ts
// פירוט מדויק של כל פנייה למסד בשלב ההשוואה: סדר, מטרה, משך round-trip,
// גבולות טרנזקציה (BEGIN/COMMIT), set_config (הקשר הרשאות), וטעינות כפולות.
// מפריד זמן round-trip (לקוח) מזמן ביצוע SQL ע"י מדידת RTT בסיס (SELECT 1).
// הרצה: tsx scripts/sim/trace-compare.ts --sim

import { randomUUID } from "node:crypto";
import { loadEnv } from "../../src/server/web/load-env.js";
import { getPool } from "../../src/server/repositories/pg-pool.js";
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { findActiveDatasetId } from "../../src/server/services/dataset-provider.js";
import { findOccupation } from "../../data/source/occupations.js";
import type { CaseFacts } from "../../src/domain/contracts/case.js";

loadEnv();
if (!(process.env.SIM_MODE === "1" || process.argv.includes("--sim"))) { console.error("dev only"); process.exit(1); }
const CONN = process.env.DATABASE_URL!;

type Row = { seq: number; sql: string; ms: number; conn: number };
const trace: Row[] = [];
let seq = 0;
let connCount = 0;
let baselineRtt = 0;

function instrument(): void {
  const pool = getPool(CONN);
  const origConnect = pool.connect.bind(pool);
  (pool as unknown as { connect: () => Promise<unknown> }).connect = async () => {
    connCount++;
    const myConn = connCount;
    const client = (await origConnect()) as { query: (...a: unknown[]) => Promise<unknown>; _w?: boolean };
    if (!client._w) {
      client._w = true;
      const oq = client.query.bind(client);
      client.query = async (...args: unknown[]) => {
        const sql = (typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text ?? JSON.stringify(args[0])) as string;
        const t = Date.now();
        try { return await oq(...args); }
        finally { trace.push({ seq: ++seq, sql: sql.replace(/\s+/g, " ").trim().slice(0, 60), ms: Date.now() - t, conn: myConn }); }
      };
    }
    return client as unknown;
  };
}

async function measureBaselineRtt(): Promise<void> {
  const pool = getPool(CONN);
  const c = await pool.connect();
  // חימום + 5 מדידות SELECT 1; מינימום = RTT רשת נקי בקירוב
  const times: number[] = [];
  for (let i = 0; i < 6; i++) { const t = Date.now(); await c.query("select 1"); if (i > 0) times.push(Date.now() - t); }
  c.release();
  baselineRtt = Math.min(...times);
}

async function main(): Promise<void> {
  await measureBaselineRtt();
  instrument();
  const repo = new PgCaseRepository(CONN);
  const service = new CaseService(repo);
  const OWNER = "trace-" + randomUUID();
  const OCC = "product_manager";
  const facts: CaseFacts = { occupationCode: OCC, reportedGroup: "ג", baseSalary: 15000, commission: 1000, bonus: 0, pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.25, qualifyingChildren: 2 };
  const datasetId = await findActiveDatasetId(CONN);

  // הכנה: תיק + חלופה (לא נספר בטרייס ההשוואה - ננקה ונתחיל טרייס נקי)
  const created = await repo.createCase({ ownerId: OWNER, isDemo: true, datasetId: datasetId!, facts, baseline: { role: "baseline", route: "company_car", vehicleCode: "CAR-09", participation: 300, maintenanceAllowance: 0 } });
  const caseId = created.case.id;
  await service.pickAlternative(caseId, OWNER, { role: "alternative", route: "company_car", vehicleCode: "CAR-10", participation: 350, maintenanceAllowance: 0 });

  // --- נקה טרייס, מדוד רק את שלב ההשוואה ---
  trace.length = 0; seq = 0;
  const t0 = Date.now();
  await service.computeAndSaveComparison(caseId, OWNER);
  const total = Date.now() - t0;

  console.log("=".repeat(78));
  console.log(`פירוט פניות DB בשלב computeAndSaveComparison`);
  console.log(`RTT רשת בסיס (min SELECT 1) = ${baselineRtt}ms  |  סה"כ שלב = ${total}ms`);
  console.log("=".repeat(78));
  console.log("#  | conn | round-trip | ~SQL(=rt-rtt) | שאילתה");
  console.log("-".repeat(78));
  let sumRt = 0, txns = new Set<number>();
  for (const r of trace) {
    sumRt += r.ms; txns.add(r.conn);
    const sqlTime = Math.max(0, r.ms - baselineRtt);
    console.log(`${String(r.seq).padStart(2)} |  ${String(r.conn).padStart(2)}  | ${String(r.ms).padStart(6)}ms   | ${String(sqlTime).padStart(6)}ms      | ${r.sql}`);
  }
  console.log("-".repeat(78));
  console.log(`סה"כ: ${trace.length} פניות | ${txns.size} חיבור/טרנזקציה | סכום round-trip=${sumRt}ms | ברשת~${trace.length * baselineRtt}ms (${Math.round(100*trace.length*baselineRtt/sumRt)}%)`);
  const begins = trace.filter((r) => /^begin/i.test(r.sql)).length;
  const commits = trace.filter((r) => /^commit/i.test(r.sql)).length;
  const setcfg = trace.filter((r) => /set_config/i.test(r.sql)).length;
  const selects = trace.filter((r) => /^select/i.test(r.sql) && !/set_config|select 1/i.test(r.sql)).length;
  console.log(`פירוק: BEGIN=${begins} COMMIT=${commits} set_config(הרשאות)=${setcfg} SELECT(תוכן)=${selects}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });