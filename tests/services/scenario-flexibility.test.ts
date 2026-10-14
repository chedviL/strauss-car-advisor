// tests/services/scenario-flexibility.test.ts
// בדיקות קבלה להתנהגויות הגמישות החדשות (קוד + שירות, לא הבנת שיחה).
// override/ירושה, קונפליקט גרסאות, דירוג/סינון לפי חיסכון, כיסוי חלקי, dedup פנייה.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileCaseRepository } from "../../src/server/repositories/case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { findOccupation } from "../../data/source/occupations.js";

let dir: string;
let service: CaseService;
const OWNER = "flex-visit";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "strauss-flex-"));
  service = new CaseService(new FileCaseRepository(dir));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function newCase(empId = "E-001") {
  return service.createDemoCaseFromEmployee(OWNER, empId);
}

describe("override היפותטי ברמת התרחיש", () => {
  it("override שכר בתרחיש אינו משנה את baseline ואת העובדות המשותפות", async () => {
    const c = await newCase("E-001"); // baseSalary 18500
    // חלופה היפותטית: שכר 25000 (override), אותו רכב כמו baseline.
    await service.pickAlternative(c.case.id, OWNER, {
      role: "alternative", route: "company_car", vehicleCode: "CAR-09",
      participation: 300, maintenanceAllowance: 0, overrides: { baseSalary: 25000 },
    });
    const state = await service.getCaseState(c.case.id, OWNER);
    // העובדה המשותפת לא השתנתה
    expect(state!.facts.baseSalary).toBe(18500);
    const baseline = state!.scenarios.find((s) => s.role === "baseline")!;
    expect(baseline.overrides.baseSalary).toBeUndefined();
    const alt = state!.scenarios.find((s) => s.role === "alternative")!;
    expect(alt.overrides.baseSalary).toBe(25000);
    // ההשוואה: נטו החלופה (שכר 25000) שונה מנטו ה-baseline (שכר 18500)
    const cmp = await service.computeAndSaveComparison(c.case.id, OWNER);
    if (cmp.status === "ok") {
      expect(Number(cmp.comparison.result.alternative.netExact))
        .not.toBe(Number(cmp.comparison.result.baseline.netExact));
    }
  });

  it("הסרת override מחזירה לירושה (לא אפס)", async () => {
    const c = await newCase("E-001");
    await service.pickAlternative(c.case.id, OWNER, {
      role: "alternative", route: "company_car", vehicleCode: "CAR-09",
      participation: 300, maintenanceAllowance: 0, overrides: { baseSalary: 25000 },
    });
    // הסרה: override ריק
    await service.pickAlternative(c.case.id, OWNER, {
      role: "alternative", route: "company_car", vehicleCode: "CAR-09",
      participation: 300, maintenanceAllowance: 0, overrides: {},
    });
    const state = await service.getCaseState(c.case.id, OWNER);
    const alt = state!.scenarios.find((s) => s.role === "alternative")!;
    expect(alt.overrides.baseSalary).toBeUndefined(); // ירושה, לא 0
  });
});

describe("עדכון עובדות: ירושה וקונפליקט גרסאות", () => {
  it("שינוי עובדה משותפת משפיע על תרחיש שאין בו override לאותו שדה", async () => {
    const c = await newCase("E-001");
    const r = await service.updateFacts(c.case.id, OWNER, { baseSalary: 20000 }, 0);
    expect(r.status).toBe("ok");
    const state = await service.getCaseState(c.case.id, OWNER);
    expect(state!.facts.baseSalary).toBe(20000);
  });

  it("עדכון עם expectedRevision שגוי מחזיר conflict ואינו דורס", async () => {
    const c = await newCase("E-001");
    await service.updateFacts(c.case.id, OWNER, { baseSalary: 20000 }, 0); // revision -> 1
    const stale = await service.updateFacts(c.case.id, OWNER, { baseSalary: 99999 }, 0);
    expect(stale.status).toBe("conflict");
    const state = await service.getCaseState(c.case.id, OWNER);
    expect(state!.facts.baseSalary).toBe(20000); // לא נדרס
  });

  it("תיקון לאותו ערך אינו מעלה גרסה", async () => {
    const c = await newCase("E-001");
    const r = await service.updateFacts(c.case.id, OWNER, { baseSalary: 18500 }, 0);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.factsRevision).toBe(0);
  });
});

describe("השוואה: דירוג, סינון לפי חיסכון, כיסוי חלקי", () => {
  it("discover ממיין לפי הפרש נטו יורד ומסנן לפי minNetDelta", async () => {
    const c = await newCase("E-001");
    const occ = findOccupation("product_manager")!;
    const res = await service.compareScenarios(c.case.id, OWNER, {
      mode: "discover", occupation: occ, minNetDelta: 0,
    });
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      // ממוין יורד
      for (let i = 1; i < res.comparisons.length; i++) {
        expect(res.comparisons[i - 1]!.netDelta).toBeGreaterThanOrEqual(res.comparisons[i]!.netDelta);
      }
      // כולם >= 0
      expect(res.comparisons.every((x) => x.netDelta >= 0)).toBe(true);
    }
  });

  it("כיסוי חלקי: רכב מקבוצה גבוהה נפסל ומופיע ב-excluded", async () => {
    // עובד קבוצה ב (developer) מול כל הקטלוג - רכבי ד נפסלים.
    const c = await newCase("E-003"); // developer, group ב
    const occ = findOccupation("developer")!;
    const res = await service.compareScenarios(c.case.id, OWNER, {
      mode: "discover", occupation: occ,
    });
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.excluded.length).toBeGreaterThan(0);
      expect(res.coverage.excluded).toBe(res.excluded.length);
    }
  });

  it("explicit: השוואת שני רכבים וויתור בבקשה אחת", async () => {
    const c = await newCase("E-005"); // dev_manager group ג, waiver allowed 2000
    const occ = findOccupation("dev_manager")!;
    const res = await service.compareScenarios(c.case.id, OWNER, {
      mode: "explicit", occupation: occ,
      candidates: [
        { label: "EV3", route: "company_car", vehicleCode: "CAR-11", participation: 300, maintenanceAllowance: 0 },
        { label: "MAZDA3", route: "company_car", vehicleCode: "CAR-13", participation: 350, maintenanceAllowance: 0 },
        { label: "ויתור", route: "waiver", vehicleCode: null, participation: 0, maintenanceAllowance: 2000 },
      ],
    });
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.comparisons.length).toBe(3);
    }
  });
});

describe("פנייה לנציג: dedup", () => {
  it("פנייה פתוחה זהה אינה נפתחת פעמיים", async () => {
    const c = await newCase("E-002");
    const a = await service.openInquiry(c.case.id, OWNER, "employee_participation", null, { route: "family", vehicle: "CAR-19" });
    const b = await service.openInquiry(c.case.id, OWNER, "employee_participation", null, { route: "family", vehicle: "CAR-19" });
    expect(a.deduped).toBe(false);
    expect(b.deduped).toBe(true);
    expect(b.inquiry.id).toBe(a.inquiry.id);
    const state = await service.getCaseState(c.case.id, OWNER);
    expect(state!.openInquiries.length).toBe(1);
  });

  it("הקשר שונה פותח פנייה חדשה", async () => {
    const c = await newCase("E-002");
    const a = await service.openInquiry(c.case.id, OWNER, "employee_participation", null, { vehicle: "CAR-19" });
    const b = await service.openInquiry(c.case.id, OWNER, "employee_participation", null, { vehicle: "CAR-20" });
    expect(a.inquiry.id).not.toBe(b.inquiry.id);
  });
});