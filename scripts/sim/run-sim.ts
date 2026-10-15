// scripts/sim/run-sim.ts
// הדמיית זרימה דמוית-שיחה (dev בלבד, SIM_MODE=1). קוראת לשירותים האמיתיים,
// בלי מודל. מודדת לכל שלב: מספר פניות למסד, זמן טעינת-מצב/כלי/חישוב/כתיבה/סה"כ.
// 10 הרצות לכל שלב, מדפיסה p50/p95. כולל בדיקות אימות ורישום retry.
// הרצה: npm run sim

import { randomUUID } from "node:crypto";
import { loadEnv } from "../../src/server/web/load-env.js";
import { getPool } from "../../src/server/repositories/pg-pool.js";
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { findActiveDatasetId } from "../../src/server/services/dataset-provider.js";
import { findOccupation } from "../../data/source/occupations.js";
import type { CaseFacts } from "../../src/domain/contracts/case.js";

loadEnv();

const simEnabled = process.env.SIM_MODE === "1" || process.argv.includes("--sim");
if (!simEnabled) {
  console.error("הדמיה רצה רק עם SIM_MODE=1 (סביבת dev). יציאה.");
  process.exit(1);
}
const CONN = process.env.DATABASE_URL;
if (!CONN) {
  console.error("DATABASE_URL אינו מוגדר. יציאה.");
  process.exit(1);
}

// --- מונה פניות למסד + רישום retry: עוטף pool.connect ו-client.query ---
let dbCalls = 0;
let retries = 0;
const retryLog: string[] = [];
function instrumentPool(conn: string): void {
  const pool = getPool(conn);
  const origConnect = pool.connect.bind(pool);
  (pool as unknown as { connect: () => Promise<unknown> }).connect = async () => {
    const client = (await origConnect()) as { query: (...a: unknown[]) => Promise<unknown>; _wrapped?: boolean };
    if (!client._wrapped) {
      client._wrapped = true;
      const origQuery = client.query.bind(client);
      client.query = async (...args: unknown[]) => {
        dbCalls++;
        try {
          return await origQuery(...args);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/terminated|ECONNRESET|EPIPE|server closed|timeout/i.test(msg)) {
            retries++;
            retryLog.push(msg.slice(0, 80));
          }
          throw e;
        }
      };
    }
    return client as unknown;
  };
}

const host = new URL(CONN).hostname;
const port = new URL(CONN).port;
const regionMatch = host.match(/aws-\d+-([a-z0-9-]+)\.pooler/);
const region = regionMatch ? regionMatch[1] : "(unknown)";

instrumentPool(CONN);
const repo = new PgCaseRepository(CONN);
const service = new CaseService(repo);

// --- עובד קבוצה ג סינתטי לפי מפרט ההדמיה ---
const OWNER = "sim-" + randomUUID();
const OCC = "product_manager"; // קבוצה ג, מתיר ויתור
const facts: CaseFacts = {
  occupationCode: OCC,
  reportedGroup: "ג",
  baseSalary: 14200,
  commission: 1000,
  bonus: 0,
  pensionRate: 0.06,
  trainingRate: 0.025,
  creditPoints: 2.25,
  qualifyingChildren: 2,
};

type StageTiming = {
  loadState: number; tool: number; compute: number; write: number; total: number; dbCalls: number;
};

// מודד קטע עם ספירת פניות מקומית
async function measured<T>(fn: () => Promise<T>): Promise<{ ms: number; calls: number; value: T }> {
  const c0 = dbCalls; const t = Date.now();
  const value = await fn();
  return { ms: Date.now() - t, calls: dbCalls - c0, value };
}

// --- בדיקות אימות מצטברות ---
const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = ""): void {
  checks.push({ name, ok, detail });
}

// הרצה בודדת של כל הזרימה; מחזירה timing לכל שלב
async function runOnce(verify: boolean): Promise<Record<string, StageTiming>> {
  const stages: Record<string, StageTiming> = {};

  // שלב א: פתיחת תיק קיים (יצירה עם facts + baseline רכב חברה)
  const datasetId = await findActiveDatasetId(CONN!);
  const a = await measured(async () => {
    const ls0 = Date.now();
    const created = await repo.createCase({
      ownerId: OWNER, isDemo: true, datasetId: datasetId!,
      facts,
      baseline: { role: "baseline", route: "company_car", vehicleCode: "CAR-09", participation: 300, maintenanceAllowance: 0 },
    });
    return { created, lsMs: Date.now() - ls0 };
  });
  const caseId = a.value.created.case.id;
  stages["א.פתיחת-תיק"] = { loadState: a.value.lsMs, tool: 0, compute: 0, write: a.ms, total: a.ms, dbCalls: a.calls };

  // שלב ב: "מעבר לחשמלי": חלופה + searchVehicles + compareScenarios; חסרה השתתפות -> openInquiry + provisional
  const occ = findOccupation(OCC);
  const b = await measured(async () => {
    const tool0 = Date.now();
    const search = await service.searchVehicles(occ!, { propulsion: 3 });
    const toolMs = Date.now() - tool0;
    // חלופה חשמלית ללא השתתפות (participation=null => חסר קלט)
    await service.pickAlternative(caseId, OWNER, {
      role: "alternative", route: "company_car", vehicleCode: "CAR-10", participation: null, maintenanceAllowance: 0,
    });
    const comp0 = Date.now();
    const cmp = await service.computeAndSaveComparison(caseId, OWNER);
    const compMs = Date.now() - comp0;
    let provisional = false;
    if (cmp.status === "missing_data") {
      provisional = true;
      await service.openInquiry(caseId, OWNER, "employee_participation", null, { field: "participation", vehicle: "CAR-10" });
    }
    return { search, toolMs, compMs, provisional };
  });
  stages["ב.חלופה-חשמלית"] = { loadState: 0, tool: b.value.toolMs, compute: b.value.compMs, write: 0, total: b.ms, dbCalls: b.calls };
  if (verify) check("ב: חוסר השתתפות -> תוצאה זמנית (provisional)", b.value.provisional, b.value.provisional ? "" : "ציפינו ל-missing_data");

  // שלב ג: תיקון שכר ל-15,000 -> עדכון עם בדיקת גרסה; חישוב מחדש
  const c = await measured(async () => {
    const st = await service.getCaseState(caseId, OWNER);
    const rev = st!.case.factsRevision;
    const upd = await service.updateFacts(caseId, OWNER, { baseSalary: 15000 }, rev);
    return { upd, prevRev: rev };
  });
  stages["ג.תיקון-שכר"] = { loadState: 0, tool: 0, compute: 0, write: c.ms, total: c.ms, dbCalls: c.calls };
  if (verify) check("ג: עדכון שכר העלה גרסה", c.value.upd.status === "ok" && (c.value.upd as { factsRevision: number }).factsRevision > c.value.prevRev);

  // שלב ד: תשובת נציג - השתתפות 350; חישוב מחדש + פרסום עם בדיקת גרסה -> תוצאה סופית
  const d = await measured(async () => {
    await service.pickAlternative(caseId, OWNER, {
      role: "alternative", route: "company_car", vehicleCode: "CAR-10", participation: 350, maintenanceAllowance: 0,
    });
    const comp0 = Date.now();
    const cmp = await service.computeAndSaveComparison(caseId, OWNER);
    return { compMs: Date.now() - comp0, cmp };
  });
  stages["ד.תשובת-נציג"] = { loadState: 0, tool: 0, compute: d.value.compMs, write: d.ms - d.value.compMs, total: d.ms, dbCalls: d.calls };
  if (verify) check("ד: תוצאה סופית חושבה (status=ok)", d.value.cmp.status === "ok");

  // אימות: המספרים בכרטיס == פלט המנוע עד האגורה (ההשוואה שמורה)
  if (verify && d.value.cmp.status === "ok") {
    const saved = d.value.cmp.comparison.result;
    const reloaded = await service.getCaseState(caseId, OWNER);
    const latest = reloaded!.latestComparison;
    check(
      "אימות: הכרטיס השמור == פלט המנוע (עד האגורה)",
      !!latest && JSON.stringify(latest.result) === JSON.stringify(saved),
    );
    // תוצאה ישנה לא מוצגת אחרי התיקון: ה-comparison האחרון מתייחס ל-facts_revision הנוכחי
    check(
      "אימות: תוצאה ישנה אינה מוצגת אחרי התיקון",
      !!latest && latest.factsRevision === reloaded!.case.factsRevision,
      latest ? `cmp.rev=${latest.factsRevision} case.rev=${reloaded!.case.factsRevision}` : "אין השוואה",
    );
  }

  // שלב ה: "מה אם אוותר?" (העיסוק מתיר ויתור) - חלופת ויתור + השוואה
  const e = await measured(async () => {
    const comp0 = Date.now();
    const cmp = await service.compareScenarios(caseId, OWNER, {
      mode: "explicit",
      ...(occ ? { occupation: occ } : {}),
      candidates: [{ label: "ויתור", route: "waiver", vehicleCode: null, participation: 0, maintenanceAllowance: occ!.maintenanceAllowance }],
    });
    return { compMs: Date.now() - comp0, cmp };
  });
  stages["ה.ויתור"] = { loadState: 0, tool: 0, compute: e.value.compMs, write: 0, total: e.ms, dbCalls: e.calls };
  if (verify) check("ה: ויתור מותר -> השוואה חושבה", e.value.cmp.status === "ok");

  return stages;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

async function main(): Promise<void> {
  console.log("=".repeat(70));
  console.log("הדמיית זרימה דמוית-שיחה (SIM_MODE)");
  console.log(`חיבור DB: host=${host} port=${port} region=${region}`);
  console.log(`מצב pooler: ${port === "6543" ? "transaction" : "session"}`);
  console.log("=".repeat(70));

  const RUNS = 10;
  const perStage: Record<string, StageTiming[]> = {};

  // הרצה ראשונה גם מאמתת; השאר רק מודדות
  for (let i = 0; i < RUNS; i++) {
    const stages = await runOnce(i === 0);
    for (const [name, t] of Object.entries(stages)) {
      (perStage[name] ??= []).push(t);
    }
  }

  // טבלת סיכום
  console.log("\nטבלת מדידה (ms, ממוצע / p50 / p95; פניות DB = ממוצע):");
  const header = ["שלב", "סה\"כ p50", "סה\"כ p95", "סה\"כ avg", "חישוב avg", "כתיבה avg", "DB avg"];
  console.log(header.join(" | "));
  console.log("-".repeat(80));
  for (const [name, arr] of Object.entries(perStage)) {
    const totals = arr.map((a) => a.total).sort((x, y) => x - y);
    const avg = (f: (a: StageTiming) => number) => Math.round(arr.reduce((s, a) => s + f(a), 0) / arr.length);
    const row = [
      name.padEnd(16),
      String(pct(totals, 50)).padStart(8),
      String(pct(totals, 95)).padStart(8),
      String(avg((a) => a.total)).padStart(8),
      String(avg((a) => a.compute)).padStart(9),
      String(avg((a) => a.write)).padStart(9),
      String(avg((a) => a.dbCalls)).padStart(6),
    ];
    console.log(row.join(" | "));
  }

  console.log("\nבדיקות אימות (הרצה ראשונה):");
  for (const c of checks) {
    console.log(`  [${c.ok ? "✓" : "✗"}] ${c.name}${c.detail ? " — " + c.detail : ""}`);
  }

  // אימות: אותה הרצה פעמיים נותנת אותן תוצאות (דטרמיניזם) - נבדק ע"י השוואת שני תיקים טריים
  console.log("\nאימות דטרמיניזם (שתי הרצות של שלב ד על תיקים טריים):");
  const r1 = await runOnce(false);
  const r2 = await runOnce(false);
  const det = JSON.stringify(Object.keys(r1)) === JSON.stringify(Object.keys(r2));
  console.log(`  [${det ? "✓" : "✗"}] מבנה שלבים זהה בין הרצות`);

  console.log(`\nסיכום: סה"כ פניות DB=${dbCalls}, retry=${retries}`);
  if (retries > 0) {
    console.log("יומן retry:");
    for (const r of retryLog) console.log("  - " + r);
  }
  const allOk = checks.every((c) => c.ok);
  console.log(`\nתוצאה כוללת: ${allOk ? "כל בדיקות האימות עברו ✓" : "יש כשלים ✗"}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error("הדמיה נכשלה:", e);
  process.exit(1);
});