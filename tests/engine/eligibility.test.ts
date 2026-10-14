// tests/engine/eligibility.test.ts
// RT-6: זכאות ומסלולים. AC-2.4.*, AC-2.5.*, AC-2.6.*.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  validateEligibility,
  type Occupation,
} from "../../src/domain/eligibility/engine.js";
import { calculateScenario } from "../../src/domain/calculation/engine.js";
import { parseRules } from "../../src/domain/calculation/rule-set-loader.js";
import type { CompleteInput } from "../../src/domain/contracts/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const { rules } = parseRules(
  readFileSync(join(here, "../../data/source/strauss-rules.json"), "utf8"),
);

const salesField: Occupation = {
  code: "sales_field", name: "נציג/ת מכירות שטח", group: "ב",
  carMandatory: true, waiverAllowed: false, maintenanceAllowance: 0,
};
const developer: Occupation = {
  code: "dev", name: "מפתח/ת תוכנה", group: "ב",
  carMandatory: false, waiverAllowed: true, maintenanceAllowance: 1500,
};

describe("RT-6: זכאות ומסלולים", () => {
  it("בחירה מקבוצה נמוכה מותרת", () => {
    const r = validateEligibility(
      { occupation: developer, route: "company_car", targetGroup: "א" },
      rules,
    );
    expect(r.status).toBe("eligible");
  });

  it("בחירה מקבוצה גבוהה חסומה", () => {
    const r = validateEligibility(
      { occupation: developer, route: "company_car", targetGroup: "ד" },
      rules,
    );
    expect(r.status).toBe("ineligible");
  });

  it("רכב חובה חוסם ויתור", () => {
    const r = validateEligibility(
      { occupation: salesField, route: "waiver" },
      rules,
    );
    expect(r.status).toBe("ineligible");
  });

  it("עיסוק המאפשר ויתור - זכאי", () => {
    const r = validateEligibility(
      { occupation: developer, route: "waiver" },
      rules,
    );
    expect(r.status).toBe("eligible");
  });

  it("מסלול משפחתי דורש 4+ ילדים", () => {
    const three = validateEligibility(
      { occupation: developer, route: "family", qualifyingChildren: 3 },
      rules,
    );
    expect(three.status).toBe("ineligible");
    const four = validateEligibility(
      { occupation: developer, route: "family", qualifyingChildren: 4 },
      rules,
    );
    expect(four.status).toBe("eligible");
  });

  it("שני רכבי משפחתי בעלויות שונות - פער שונה (CARNIVAL מול SANTA FE)", () => {
    const common: Omit<CompleteInput, "companyCarCost"> = {
      route: "family", group: "ב", baseSalary: 9800, commission: 2400,
      bonus: 0, pensionRate: 0.06, trainingRate: 0, creditPoints: 2.25,
      valueOfUse: 8120, isElectric: false, participation: 500,
      maintenanceAllowance: 0,
    };
    const carnival = calculateScenario({ ...common, companyCarCost: 6000 }, rules);
    const santaFe = calculateScenario({ ...common, companyCarCost: 5600 }, rules);
    // פער = max(0, cost-budget)*0.5; תקציב ב=3700
    expect(Number(carnival.breakdown.familyGap)).toBe((6000 - 3700) * 0.5); // 1150
    expect(Number(santaFe.breakdown.familyGap)).toBe((5600 - 3700) * 0.5); // 950
  });
});