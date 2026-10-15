// tests/agent/fast-plan-executor.test.ts
// רגרסיה ל-executor של המסלול המהיר (ללא מודל): ביצוע תוכנית פעולות על חוזי
// השירות הקיימים. מאמת שער הקבלה: תיקון+השוואה, סימולציות base/commission/bonus
// כולל אפס מפורש, הסרת override, baseline ללא שינוי, מספרים==מנוע, כשל חלקי.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileCaseRepository } from "../../src/server/repositories/case-repository.js";
import { CaseService, computeScenario } from "../../src/server/services/case-service.js";
import { executeFastPlan, type FastPlan } from "../../src/server/agent/fast-path.js";
import { getActiveDataset } from "../../src/server/services/dataset-provider.js";
import type { CaseFacts } from "../../src/domain/contracts/case.js";

let dir: string; let service: CaseService;
const OWNER = "fp-test";
const facts: CaseFacts = { occupationCode:"product_manager", reportedGroup:"ג", baseSalary:14200, commission:1000, bonus:0, pensionRate:0.06, trainingRate:0.025, creditPoints:2.25, qualifyingChildren:2 };

beforeEach(() => { dir = mkdtempSync(join(tmpdir(),"strauss-fp-")); service = new CaseService(new FileCaseRepository(dir)); });
afterEach(() => rmSync(dir, { recursive:true, force:true }));

async function newCase() {
  // FileCaseRepository: contentId משמש datasetId. יוצרים תיק עם facts+baseline.
  const ds = getActiveDataset();
  const repo = new FileCaseRepository(dir);
  return repo.createCase({ ownerId: OWNER, isDemo:true, datasetId: ds.contentId, facts, baseline:{ role:"baseline", route:"company_car", vehicleCode:"CAR-09", participation:300, maintenanceAllowance:0 } });
}
const st = (id: string) => service.getCaseState(id, OWNER);

describe("fast-plan executor (ללא מודל)", () => {
  it("תיקון + השוואה בתוכנית אחת: שכר נשמר, גרסה לא כפולה, כרטיס מחושב על המעודכן", async () => {
    const c = await newCase();
    const plan: FastPlan = { clarify:false, reply:"ok", actions:[
      { type:"update_facts", set:{ baseSalary:19000 } },
      { type:"compare", mode:"discover", propulsion:"3" },
    ]};
    const r = await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, plan);
    const s = (await st(c.case.id))!;
    expect(s.facts.baseSalary).toBe(19000);
    expect(s.case.factsRevision).toBe(1);
    expect(r.did.compared).toBe(true);
    expect(s.latestComparison).not.toBeNull();
  });

  it("סימולציות base/commission/bonus כולל אפס מפורש; baseline לא משתנה", async () => {
    const c = await newCase();
    const plan: FastPlan = { clarify:false, reply:"ok", actions:[
      { type:"set_simulation", overrides:{ baseSalary:25000, commission:0, bonus:3000 } },
    ]};
    await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, plan);
    const s = (await st(c.case.id))!;
    const alt = s.scenarios.find((x) => x.role === "alternative")!;
    expect(alt.overrides.baseSalary).toBe(25000);
    expect(alt.overrides.commission).toBe(0);
    expect(alt.overrides.bonus).toBe(3000);
    expect(s.facts.baseSalary).toBe(14200); // baseline/עובדה אמיתית לא השתנתה
  });

  it("הסרת override מחזירה לירושה", async () => {
    const c = await newCase();
    await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, { clarify:false, reply:"", actions:[{ type:"set_simulation", overrides:{ baseSalary:30000 } }] });
    await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, { clarify:false, reply:"", actions:[{ type:"clear_simulation" }] });
    const s = (await st(c.case.id))!;
    const alt = s.scenarios.find((x) => x.role === "alternative")!;
    expect(Object.keys(alt.overrides)).toHaveLength(0);
  });

  it("מספרים בכרטיס == פלט המנוע (עד האגורה)", async () => {
    const c = await newCase();
    await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, { clarify:false, reply:"", actions:[{ type:"compare", mode:"explicit", vehicleCodes:["CAR-10"] }] });
    const s = (await st(c.case.id))!;
    const alt = s.scenarios.find((x) => x.role === "alternative")!;
    const direct = computeScenario(s.facts, alt, getActiveDataset());
    expect(direct.status).toBe("ok");
    if (direct.status === "ok") {
      expect(s.latestComparison!.result.alternative.netDisplay).toBe(direct.result.netDisplay);
    }
  });

  it("כשל חלקי: קונפליקט גרסה מדווח ולא שומר ערך שגוי", async () => {
    const c = await newCase();
    await service.updateFacts(c.case.id, OWNER, { bonus:500 }, 0); // rev -> 1
    const stale = (await st(c.case.id))!;
    const faked = { ...stale, case: { ...stale.case, factsRevision: 0 } }; // גרסה ישנה
    const r = await executeFastPlan(service, c.case.id, OWNER, faked, { clarify:false, reply:"ok", actions:[{ type:"update_facts", set:{ baseSalary:21000 } }] });
    const s = (await st(c.case.id))!;
    expect(r.conflict).toBe(true);
    expect(s.facts.baseSalary).toBe(14200); // לא נשמר שכר שגוי
    expect(r.partialFailure ?? r.reply).toBeTruthy();
  });
});