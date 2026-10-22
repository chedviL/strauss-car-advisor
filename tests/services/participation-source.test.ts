// tests/services/participation-source.test.ts
// רגרסיה: הבחנה בין השתתפות מאומתת (כולל אפס מפורש), ברירת מחדל מותרת
// (מתועדת כהנחה), לבין מידע חסר. אין להפוך חוסר לאפס בשקט (step 2).

import { describe, it, expect } from "vitest";
import { resolveScenarioInput, computeScenario } from "../../src/server/services/case-service.js";
import { getActiveDataset } from "../../src/server/services/dataset-provider.js";
import type { CaseFacts, Scenario } from "../../src/domain/contracts/case.js";

const dataset = getActiveDataset();

const facts: CaseFacts = {
  occupationCode: "product_manager", reportedGroup: "ג",
  baseSalary: 15000, commission: 1000, bonus: 0,
  pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.25, qualifyingChildren: 2,
};

// רכב עם ברירת מחדל של השתתפות בקטלוג
const sampleVehicle = [...dataset.vehiclesByCode.values()].find(
  (v) => v.group !== "משפחתי" && v.defaultParticipation !== null && v.defaultParticipation !== undefined,
)!;

function scenario(partial: Partial<Scenario>): Scenario {
  return {
    id: "s", caseId: "c", role: "alternative", route: "company_car",
    vehicleCode: sampleVehicle.id, participation: null, maintenanceAllowance: 0,
    overrides: {}, revision: 0, ...partial,
  };
}

describe("מקור ההשתתפות (step 2)", () => {
  it("ערך מאומת שנמסר (כולל 0 מפורש) משמש כפי שהוא, ללא הנחה", () => {
    const r0 = resolveScenarioInput(facts, scenario({ participation: 0 }), dataset);
    expect(r0.status).toBe("ok");
    expect(r0.input!.participation).toBe(0);
    expect(r0.assumptions ?? []).toHaveLength(0);

    const r350 = resolveScenarioInput(facts, scenario({ participation: 350 }), dataset);
    expect(r350.status).toBe("ok");
    expect(r350.input!.participation).toBe(350);
    expect(r350.assumptions ?? []).toHaveLength(0);
  });

  it("השתתפות חסרה עם ברירת מחדל בקטלוג: משמשת ומתועדת כהנחה", () => {
    const r = resolveScenarioInput(facts, scenario({ participation: null }), dataset);
    expect(r.status).toBe("ok");
    expect(r.input!.participation).toBe(sampleVehicle.defaultParticipation);
    expect((r.assumptions ?? []).join(" ")).toContain("השתתפות");
  });

  it("פנייה פתוחה על אותו תרחיש: ברירת מחדל לא משמשת — חוסר נדרש", () => {
    const s = scenario({ id: "scen-with-inquiry", participation: null });
    const openIds = new Set(["scen-with-inquiry"]);
    const r = resolveScenarioInput(facts, s, dataset, openIds);
    expect(r.status).toBe("missing_data");
    expect(r.missingFields).toContain("participation");
  });

  it("ההנחה על ברירת המחדל זורמת לתוצאת החישוב (assumptions)", () => {
    const res = computeScenario(facts, scenario({ participation: null }), dataset);
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.result.assumptions.some((a) => a.includes("השתתפות"))).toBe(true);
    }
  });

  it("השתתפות חסרה וללא ברירת מחדל מותרת: מצב חוסר (missing_data), לא אפס שקט", () => {
    // רכב עם defaultParticipation=null מדמה היעדר ברירת מחדל מותרת
    const noDefault = scenario({ participation: null });
    const patchedDataset = {
      ...dataset,
      vehiclesByCode: new Map(dataset.vehiclesByCode),
    };
    const v = patchedDataset.vehiclesByCode.get(sampleVehicle.id)!;
    patchedDataset.vehiclesByCode.set(sampleVehicle.id, { ...v, defaultParticipation: null as unknown as number });
    const r = resolveScenarioInput(facts, noDefault, patchedDataset);
    expect(r.status).toBe("missing_data");
    expect(r.missingFields).toContain("participation");
  });

  it("ויתור: אין השתתפות ברכב, אפס מובנה ללא הנחה", () => {
    const r = resolveScenarioInput(facts, scenario({ route: "waiver", vehicleCode: null, maintenanceAllowance: 2000 }), dataset);
    expect(r.status).toBe("ok");
    expect(r.input!.participation).toBe(0);
    expect((r.assumptions ?? []).some((a) => a.includes("השתתפות"))).toBe(false);
  });
});