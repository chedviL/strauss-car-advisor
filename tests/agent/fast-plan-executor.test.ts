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
    const plan: FastPlan = { clarify:false, needsFollowup:false, reply:"ok", actions:[
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
    const plan: FastPlan = { clarify:false, needsFollowup:false, reply:"ok", actions:[
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
    await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, { clarify:false, needsFollowup:false, reply:"", actions:[{ type:"set_simulation", overrides:{ baseSalary:30000 } }] });
    await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, { clarify:false, needsFollowup:false, reply:"", actions:[{ type:"clear_simulation" }] });
    const s = (await st(c.case.id))!;
    const alt = s.scenarios.find((x) => x.role === "alternative")!;
    expect(Object.keys(alt.overrides)).toHaveLength(0);
  });

  it("מספרים בכרטיס == פלט המנוע (עד האגורה)", async () => {
    const c = await newCase();
    await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, { clarify:false, needsFollowup:false, reply:"", actions:[{ type:"compare", mode:"explicit", vehicleCodes:["CAR-10"] }] });
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
    const r = await executeFastPlan(service, c.case.id, OWNER, faked, { clarify:false, needsFollowup:false, reply:"ok", actions:[{ type:"update_facts", set:{ baseSalary:21000 } }] });
    const s = (await st(c.case.id))!;
    expect(r.conflict).toBe(true);
    expect(s.facts.baseSalary).toBe(14200); // לא נשמר שכר שגוי
    expect(r.partialFailure ?? r.reply).toBeTruthy();
  });

  it("search_vehicles: מחזיר תוצאות + needsFollowup (תלוי-תוצאה)", async () => {
    const c = await newCase();
    const r = await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, { clarify:false, needsFollowup:true, reply:"בודקת", actions:[{ type:"search_vehicles", propulsion:"3" }] });
    expect(r.did.searched).toBe(true);
    expect(r.needsFollowup).toBe(true);
    expect(r.actionResults.some((a) => a.type === "search_vehicles")).toBe(true);
  });

  it("compare_detail: דורש השוואה שמורה; בלי השוואה -> כשל חלקי מדווח", async () => {
    const c = await newCase();
    const r = await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, { clarify:false, needsFollowup:false, reply:"", actions:[{ type:"compare_detail" }] });
    expect(r.did.detailed).toBe(false);
    expect(r.partialFailure).toBeTruthy();
  });

  it("open_inquiry: נפתחת פנייה לנציג (לא תלוי-תוצאה, בלי followup)", async () => {
    const c = await newCase();
    const r = await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, { clarify:false, needsFollowup:false, reply:"אפנה לנציג", actions:[{ type:"open_inquiry", inquiryType:"employee_participation" }] });
    expect(r.did.inquiry).toBe(true);
    const s = (await st(c.case.id))!;
    expect(s.openInquiries.some((q) => q.type === "employee_participation")).toBe(true);
  });

  it("compare -> needsFollowup=true ו-actionResults כולל את התוצאה", async () => {
    const c = await newCase();
    const r = await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, { clarify:false, needsFollowup:true, reply:"בודקת", actions:[{ type:"compare", mode:"discover", propulsion:"3" }] });
    expect(r.did.compared).toBe(true);
    expect(r.needsFollowup).toBe(true);
    const compareResult = r.actionResults.find((a) => a.type === "compare");
    expect(compareResult).toBeTruthy();
  });

  it("set_current_vehicle: הרכב הנוכחי מתעדכן ב-baseline, לא כחלופה", async () => {
    const c = await newCase(); // baseline מתחיל כ-CAR-09
    const r = await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, { clarify:false, needsFollowup:false, reply:"", actions:[{ type:"set_current_vehicle", vehicleCode:"CAR-10" }] });
    expect(r.did.currentVehicle).toBe(true);
    const s = (await st(c.case.id))!;
    const base = s.scenarios.find((x) => x.role === "baseline")!;
    expect(base.vehicleCode).toBe("CAR-10"); // baseline עודכן
    const alt = s.scenarios.find((x) => x.role === "alternative");
    expect(alt).toBeUndefined(); // לא נוצרה חלופה
  });

  it("search_vehicles עובד לפי קבוצה שנמסרה גם בלי עיסוק (זכאות מקבוצה)", async () => {
    // תיק עם קבוצה ג אבל ללא occupationCode
    const ds = getActiveDataset();
    const repo = new FileCaseRepository(dir);
    const noOcc = { ...facts, occupationCode: null };
    const created = await repo.createCase({ ownerId: OWNER, isDemo:true, datasetId: ds.contentId, facts: noOcc, baseline:{ role:"baseline", route:"company_car", vehicleCode:"CAR-09", participation:300, maintenanceAllowance:0 } });
    const r = await executeFastPlan(service, created.case.id, OWNER, (await st(created.case.id))!, { clarify:false, needsFollowup:true, reply:"בודקת", actions:[{ type:"search_vehicles", propulsion:"3" }] });
    expect(r.did.searched).toBe(true); // לא נחסם בגלל חוסר עיסוק
    expect(r.partialFailure).toBeUndefined();
  });
  // --- בקשה פעילה עמידה (pending request) + המשך אוטומטי אחרי השלמת נתונים ---

  // תיק ללא שכר בסיס -> compare נעצר על מידע חסר.
  async function caseNoSalary() {
    const ds = getActiveDataset();
    const repo = new FileCaseRepository(dir);
    const noSal = { ...facts, baseSalary: null };
    return repo.createCase({ ownerId: OWNER, isDemo:true, datasetId: ds.contentId, facts: noSal, baseline:{ role:"baseline", route:"company_car", vehicleCode:"CAR-09", participation:300, maintenanceAllowance:0 } });
  }

  it("compare נעצר על מידע חסר -> הבקשה נשמרת כפעילה (pending)", async () => {
    const c = await caseNoSalary();
    const r = await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, { clarify:false, needsFollowup:false, reply:"צריך שכר", actions:[{ type:"compare", mode:"explicit", vehicleCodes:["CAR-10"] }] });
    expect(r.did.compared).toBe(false);
    expect(r.partialFailure).toBeTruthy();
    const s = (await st(c.case.id))!;
    expect(s.case.pendingRequest).toEqual({ kind:"compare", mode:"explicit", vehicleCodes:["CAR-10"] });
  });

  it("השלמת שכר (בלי compare מפורש) מפעילה מחדש את ההשוואה הפעילה -> כרטיס + ניקוי pending", async () => {
    const c = await caseNoSalary();
    // תור 1: compare נעצר -> pending נשמר
    await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, { clarify:false, needsFollowup:false, reply:"צריך שכר", actions:[{ type:"compare", mode:"explicit", vehicleCodes:["CAR-10"] }] });
    // תור 2: רק עדכון עובדות (המודל לא חזה compare)
    const r = await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, { clarify:false, needsFollowup:false, reply:"קיבלתי", actions:[{ type:"update_facts", set:{ baseSalary:15000, commission:0, bonus:0 } }] });
    expect(r.did.compared).toBe(true); // הופעלה אוטומטית
    expect(r.needsFollowup).toBe(true); // כדי שהתוצאה תנוסח
    expect(r.actionResults.some((a) => a.type === "compare")).toBe(true);
    const s = (await st(c.case.id))!;
    expect(s.latestComparison).not.toBeNull();
    expect(s.case.pendingRequest).toBeNull(); // נוקתה אחרי הצלחה
  });

  it("שינוי כיוון (search_vehicles) מנקה בקשה פעילה ואינו מפעיל compare אוטומטי", async () => {
    const c = await caseNoSalary();
    await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, { clarify:false, needsFollowup:false, reply:"צריך שכר", actions:[{ type:"compare", mode:"explicit", vehicleCodes:["CAR-10"] }] });
    // המשתמשת עברה לנושא אחר: חיפוש רכבים
    const r = await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, { clarify:false, needsFollowup:true, reply:"בודקת", actions:[{ type:"search_vehicles", propulsion:"3" }] });
    expect(r.did.searched).toBe(true);
    expect(r.did.compared).toBe(false); // לא הופעל compare אוטומטי
    const s = (await st(c.case.id))!;
    expect(s.case.pendingRequest).toBeNull(); // הבקשה הפעילה נוקתה
  });

  it("ההשוואה האוטומטית רצה פעם אחת בלבד: תור נוסף אחרי הצלחה לא יוצר השוואה חדשה", async () => {
    const c = await caseNoSalary();
    await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, { clarify:false, needsFollowup:false, reply:"צריך שכר", actions:[{ type:"compare", mode:"explicit", vehicleCodes:["CAR-10"] }] });
    await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, { clarify:false, needsFollowup:false, reply:"קיבלתי", actions:[{ type:"update_facts", set:{ baseSalary:15000 } }] });
    const afterFirst = (await st(c.case.id))!;
    expect(afterFirst.case.pendingRequest).toBeNull();
    // תור 3: עדכון נוסף - אין pending, אסור להפעיל compare אוטומטי
    const r3 = await executeFastPlan(service, c.case.id, OWNER, (await st(c.case.id))!, { clarify:false, needsFollowup:false, reply:"קיבלתי", actions:[{ type:"update_facts", set:{ bonus:200 } }] });
    expect(r3.did.compared).toBe(false); // אין בקשה פעילה -> אין השוואה אוטומטית
  });
});
