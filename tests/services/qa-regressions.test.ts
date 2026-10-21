// tests/services/qa-regressions.test.ts
// רגרסיות מבדיקת ה-QA, ברמת השירות (אחסון קבצים, ללא DB וללא מודל):
//  H1 סימולציית שכר נשמרת ומוחלת בהשוואה; H2 זכאות עם קבוצה בלבד; חסר != זכאי;
//  H3 עדכניות לפי גרסת תרחיש; ואימות עובדות (NaN/שלילי/שיעור/שדה לא מוכר/עיסוק לא מוכר).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileCaseRepository } from "../../src/server/repositories/case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { InvalidFactsError } from "../../src/server/services/facts-validation.js";
import { isComparisonStale } from "../../src/domain/calculation/staleness.js";
import { CATALOG } from "../../data/source/catalog.js";

let dir: string;
let service: CaseService;
const OWNER = "qa-owner";
const groupOf = (code: string | null) => CATALOG.find((v) => v.id === code)?.group;
const RANK = ["א", "ב", "ג", "ד"];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "strauss-qa-"));
  service = new CaseService(new FileCaseRepository(dir));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("H1: סימולציית שכר שמורה חלה על ההשוואה ואינה נמחקת", () => {
  it("override על החלופה -> נטו החלופה שקול למצב שבו השכר באמת גבוה; ה-override נשמר", async () => {
    const sim = await service.createDemoCaseFromEmployee(OWNER, "E-001"); // שכר 18,500
    await service.pickAlternative(sim.case.id, OWNER, {
      role: "alternative", route: "company_car", vehicleCode: "CAR-10",
      participation: 300, maintenanceAllowance: 0, overrides: { baseSalary: 30000 },
    });
    const res = await service.compareScenarios(sim.case.id, OWNER, {
      mode: "explicit",
      candidates: [{ label: "ATTO 3", route: "company_car", vehicleCode: "CAR-10", participation: 300, maintenanceAllowance: 0 }],
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;

    // שכר אמיתי 30,000 באותה חלופה, בלי override -> אותו נטו חלופה (נגזר עצמאית).
    const real = await service.createDemoCaseFromEmployee(OWNER, "E-001");
    await service.updateFacts(real.case.id, OWNER, { baseSalary: 30000 }, 0);
    const realRes = await service.compareScenarios(real.case.id, OWNER, {
      mode: "explicit",
      candidates: [{ label: "ATTO 3", route: "company_car", vehicleCode: "CAR-10", participation: 300, maintenanceAllowance: 0 }],
    });
    expect(realRes.status).toBe("ok");
    if (realRes.status !== "ok") return;
    expect(res.comparisons[0]!.net).toBe(realRes.comparisons[0]!.net);
    // ה-baseline נשאר על השכר האמיתי (18,500): נטו baseline שונה מהמקרה "שכר אמיתי 30,000".
    expect(res.baseline.net).not.toBe(realRes.baseline.net);
    expect(res.baseline.net).toBe(11032); // ייחוס E-001

    // ה-override לא נמחק, והשקיפות מופיעה בהנחות.
    const state = await service.getCaseState(sim.case.id, OWNER);
    const alt = state!.scenarios.find((s) => s.role === "alternative")!;
    expect(alt.overrides.baseSalary).toBe(30000);
    expect(state!.facts.baseSalary).toBe(18500);
    expect(res.comparisons[0]!.result.assumptions[0]).toContain("סימולציית שכר");
  });

  it("בלי סימולציה: התוצאה זהה לייחוס (E-001 -> ATTO 3 = 11,693, +661)", async () => {
    const c = await service.createDemoCaseFromEmployee(OWNER, "E-001");
    const res = await service.compareScenarios(c.case.id, OWNER, {
      mode: "explicit",
      candidates: [{ label: "ATTO 3", route: "company_car", vehicleCode: "CAR-10", participation: 300, maintenanceAllowance: 0 }],
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.baseline.net).toBe(11032);
    expect(res.comparisons[0]!.net).toBe(11693);
    expect(res.comparisons[0]!.netDelta).toBe(661);
    expect(res.comparisons[0]!.result.assumptions.join(" ")).not.toContain("סימולציית שכר");
  });
});

describe("H2: זכאות כשידועה רק הקבוצה (בלי קוד עיסוק)", () => {
  it("discover לא מחשב רכבים מקבוצה גבוהה מהקבוצה, ולא מציע ויתור בלי עיסוק מאומת", async () => {
    const c = await service.createDemoCaseFromEmployee(OWNER, "E-003"); // קבוצה ב'
    await service.updateFacts(c.case.id, OWNER, { occupationCode: null }, 0);
    const res = await service.compareScenarios(c.case.id, OWNER, { mode: "discover", includeWaiver: true });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.comparisons.length).toBeGreaterThan(0);
    for (const row of res.comparisons) {
      if (row.route === "waiver") throw new Error("ויתור הוצע בלי עיסוק מאומת");
      expect(RANK.indexOf(groupOf(row.vehicleCode)!)).toBeLessThanOrEqual(RANK.indexOf("ב"));
    }
    expect(res.excluded.some((e) => e.label === "ויתור")).toBe(true);
    expect(res.excluded.some((e) => e.label === "CAR-17")).toBe(true); // SEAL, קבוצה ד'
  });
});

describe("חסר אינו זכאות; רכב משפחתי רק במסלול משפחתי", () => {
  it("מסלול משפחתי עם מספר ילדים לא ידוע -> לא מחושב (incomplete)", async () => {
    const c = await service.createDemoCaseFromEmployee(OWNER, "E-002"); // 5 ילדים
    await service.updateFacts(c.case.id, OWNER, { qualifyingChildren: null }, 0);
    const res = await service.compareScenarios(c.case.id, OWNER, {
      mode: "explicit",
      candidates: [{ label: "CARNIVAL", route: "family", vehicleCode: "CAR-19", participation: 500, maintenanceAllowance: 0 }],
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.comparisons).toHaveLength(0);
    expect(res.incomplete[0]!.missingFields).toContain("qualifyingChildren");
  });

  it("E-002 משפחתי עם 5 ילדים: נטו 5,078 (ייחוס) ללא שינוי", async () => {
    const c = await service.createDemoCaseFromEmployee(OWNER, "E-002");
    const res = await service.compareScenarios(c.case.id, OWNER, {
      mode: "explicit",
      candidates: [{ label: "CARNIVAL", route: "family", vehicleCode: "CAR-19", participation: 500, maintenanceAllowance: 0 }],
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.baseline.net).toBe(8600);
    expect(res.comparisons[0]!.net).toBe(5078);
  });

  it("רכב משפחתי דרך מסלול רגיל נדחה; רכב רגיל דרך מסלול משפחתי נדחה", async () => {
    const c = await service.createDemoCaseFromEmployee(OWNER, "E-002");
    const res = await service.compareScenarios(c.case.id, OWNER, {
      mode: "explicit",
      candidates: [
        { label: "CARNIVAL-רגיל", route: "company_car", vehicleCode: "CAR-19", participation: 500, maintenanceAllowance: 0 },
        { label: "NIRO-משפחתי", route: "family", vehicleCode: "CAR-05", participation: 250, maintenanceAllowance: 0 },
      ],
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.comparisons).toHaveLength(0);
    expect(res.excluded.map((e) => e.label).sort()).toEqual(["CARNIVAL-רגיל", "NIRO-משפחתי"]);
  });
});

describe("H3: עדכניות השוואה לפי גרסאות תרחיש", () => {
  it("אחרי השוואה: עדכנית; אחרי שינוי השתתפות נוכחית: מיושנת", async () => {
    const c = await service.startDemoFlow(OWNER, "E-001"); // baseline + חלופה + השוואה שמורה
    let s = (await service.getCaseState(c.case.id, OWNER))!;
    expect(s.latestComparison).not.toBeNull();
    expect(isComparisonStale(s)).toBe(false);
    await service.updateBaselineVehicle(c.case.id, OWNER, { route: "company_car", vehicleCode: "CAR-09", participation: 500, maintenanceAllowance: 0 });
    s = (await service.getCaseState(c.case.id, OWNER))!;
    expect(s.case.factsRevision).toBe(0); // גרסת העובדות לא השתנתה - ובכל זאת מיושנת
    expect(isComparisonStale(s)).toBe(true);
    await service.computeAndSaveComparison(c.case.id, OWNER);
    s = (await service.getCaseState(c.case.id, OWNER))!;
    expect(isComparisonStale(s)).toBe(false);
  });
});

describe("אימות עובדות בשכבת השירות", () => {
  async function fresh() { return service.createDemoCaseFromEmployee(OWNER, "E-001"); }

  it.each([
    ["NaN", { baseSalary: NaN }],
    ["Infinity", { baseSalary: Infinity }],
    ["שכר שלילי", { baseSalary: -1 }],
    ["שכר אסטרונומי", { baseSalary: 1e12 }],
    ["פנסיה 6 (=600%)", { pensionRate: 6 }],
    ["קרן השתלמות שלילית", { trainingRate: -0.01 }],
    ["נקודות זיכוי 21", { creditPoints: 21 }],
    ["ילדים שברי", { qualifyingChildren: 2.5 }],
    ["ילדים שליליים", { qualifyingChildren: -1 }],
    ["קבוצה לא מוכרת", { reportedGroup: "xyz" }],
    ["קבוצה 'משפחתי' אינה קבוצת זכאות", { reportedGroup: "משפחתי" }],
    ["עיסוק לא מוכר", { occupationCode: "wizard" }],
    ["שדה לא מוכר", { evil: 1 }],
    ["מחרוזת במקום מספר", { baseSalary: "1000" }],
  ])("נדחה: %s", async (_n, patch) => {
    const c = await fresh();
    await expect(service.updateFacts(c.case.id, OWNER, patch as never, 0)).rejects.toBeInstanceOf(InvalidFactsError);
    const s = await service.getCaseState(c.case.id, OWNER);
    expect(s!.facts.baseSalary).toBe(18500); // לא נכתב דבר
    expect(s!.case.factsRevision).toBe(0);
  });

  it("אפס מפורש ו-null (ניקוי) תקינים וגרסה עולה", async () => {
    const c = await fresh();
    const r = await service.updateFacts(c.case.id, OWNER, { commission: 0, bonus: null, pensionRate: 0.065 }, 0);
    expect(r.status).toBe("ok");
    const s = await service.getCaseState(c.case.id, OWNER);
    expect(s!.facts.commission).toBe(0);
    expect(s!.facts.bonus).toBeNull();
    expect(s!.facts.pensionRate).toBe(0.065);
  });

  it("החלת תלוש: null אינו דורס, ושדות שאינם שדות תלוש נדחים", async () => {
    const c = await fresh();
    const ok = await service.applyPayslip(c.case.id, OWNER, "u1", { baseSalary: 20000, commission: null } as never, 0);
    expect(ok.status).toBe("applied");
    const s = await service.getCaseState(c.case.id, OWNER);
    expect(s!.facts.baseSalary).toBe(20000);
    expect(s!.facts.commission).toBe(0); // נשאר כפי שהיה (E-001: 0), לא נמחק
    await expect(service.applyPayslip(c.case.id, OWNER, "u1", { qualifyingChildren: 99 } as never, 1)).rejects.toBeInstanceOf(InvalidFactsError);
    await expect(service.applyPayslip(c.case.id, OWNER, "u1", { reportedGroup: "ד" } as never, 1)).rejects.toBeInstanceOf(InvalidFactsError);
  });
});

describe("זיהוי רכב לפי שם בעברית", () => {
  it("'סיל' מזהה את SEAL (\\b לא עובד עם עברית)", async () => {
    const r = await service.lookupVehicleByName("סיל");
    expect(r.status).toBe("found");
    if (r.status === "found") expect(r.vehicle.id).toBe("CAR-17");
    const r2 = await service.lookupVehicleByName("BYD סיל חשמלי");
    expect(r2.status).toBe("found");
  });
  it("רכב משפחתי בשם: מוערך כמסלול משפחתי (לא 'קבוצה לא מזוהה')", async () => {
    const dev = (await import("../../data/source/occupations.js")).findOccupation("developer")!;
    const r = await service.lookupVehicleByName("קרניבל", dev);
    expect(r.status).toBe("found");
    if (r.status === "found") expect(r.reasons.join(" ")).not.toContain("קבוצה לא מזוהה");
  });
});
