// tests/engine/properties.test.ts
// תכונות נכונוּת (PBT) P1/P3/P4 ובדיקות גבול RT-5. fast-check.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { calculateScenario } from "../../src/domain/calculation/engine.js";
import { parseRules } from "../../src/domain/calculation/rule-set-loader.js";
import type { CompleteInput } from "../../src/domain/contracts/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const { rules } = parseRules(
  readFileSync(join(here, "../../data/source/strauss-rules.json"), "utf8"),
);

const arbInput: fc.Arbitrary<CompleteInput> = fc.record({
  route: fc.constant("company_car" as const),
  group: fc.constantFrom("א", "ב", "ג", "ד"),
  baseSalary: fc.integer({ min: 4000, max: 80000 }),
  commission: fc.integer({ min: 0, max: 20000 }),
  bonus: fc.integer({ min: 0, max: 20000 }),
  pensionRate: fc.constantFrom(0, 0.06, 0.065, 0.07),
  trainingRate: fc.constantFrom(0, 0.025),
  creditPoints: fc.constantFrom(0, 2.25, 2.75),
  valueOfUse: fc.integer({ min: 0, max: 9000 }),
  isElectric: fc.boolean(),
  participation: fc.integer({ min: 0, max: 1000 }),
  companyCarCost: fc.integer({ min: 2000, max: 6000 }),
  maintenanceAllowance: fc.constant(0),
});

describe("Property 1: דטרמיניזם (AC-2.2.1)", () => {
  it("אותו קלט + אותם כללים → פלט זהה עד האגורה", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const a = calculateScenario(input, rules);
        const b = calculateScenario(input, rules);
        expect(a.netExact).toBe(b.netExact);
        expect(a.breakdown).toEqual(b.breakdown);
      }),
      { numRuns: 300 },
    );
  });
});

describe("Property 3: מונוטוניות מס שולי (AC-2.2.2)", () => {
  it("הגדלת שכר הבסיס אינה מקטינה את מס ההכנסה", () => {
    fc.assert(
      fc.property(
        arbInput,
        fc.integer({ min: 1, max: 10000 }),
        (input, bump) => {
          const low = calculateScenario(input, rules);
          const high = calculateScenario(
            { ...input, baseSalary: input.baseSalary + bump },
            rules,
          );
          expect(Number(high.breakdown.incomeTax)).toBeGreaterThanOrEqual(
            Number(low.breakdown.incomeTax) - 1e-6,
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("Property 4: אי-שליליות (AC-2.2.4)", () => {
  it("מס הכנסה לעולם אינו שלילי", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const r = calculateScenario(input, rules);
        expect(Number(r.breakdown.incomeTax)).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 300 },
    );
  });
});

describe("Property 6: שווי שימוש מגדיל בסיס מס אך אינו מזומן (AC-2.2.5)", () => {
  it("הגדלת שווי שימוש מגדילה מס/ביטוח אך לא את המזומן", () => {
    fc.assert(
      fc.property(arbInput, fc.integer({ min: 1, max: 3000 }), (input, bump) => {
        const lo = calculateScenario({ ...input, isElectric: false }, rules);
        const hi = calculateScenario(
          { ...input, isElectric: false, valueOfUse: input.valueOfUse + bump },
          rules,
        );
        expect(hi.breakdown.cashSalary).toBe(lo.breakdown.cashSalary);
        expect(Number(hi.breakdown.incomeTax)).toBeGreaterThanOrEqual(
          Number(lo.breakdown.incomeTax) - 1e-6,
        );
        // שווי שימוש גבוה יותר → נטו נמוך יותר או שווה (הטבה חייבת, לא מזומן)
        expect(Number(hi.netExact)).toBeLessThanOrEqual(Number(lo.netExact) + 1e-6);
      }),
      { numRuns: 300 },
    );
  });
});

describe("RT-5: בדיקות גבול", () => {
  it("אותו תרחיש מול עצמו → הפרש אפס", () => {
    const input: CompleteInput = {
      route: "company_car", group: "ג", baseSalary: 18500, commission: 0,
      bonus: 0, pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.75,
      valueOfUse: 4070, isElectric: false, participation: 300,
      companyCarCost: 4300, maintenanceAllowance: 0,
    };
    const a = calculateScenario(input, rules);
    const b = calculateScenario(input, rules);
    expect(Number(a.netExact) - Number(b.netExact)).toBe(0);
  });

  it("זיכוי מעל המס → מס אפס, לא שלילי", () => {
    const input: CompleteInput = {
      route: "company_car", group: "א", baseSalary: 4500, commission: 0,
      bonus: 0, pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.75,
      valueOfUse: 0, isElectric: false, participation: 0,
      companyCarCost: 2650, maintenanceAllowance: 0,
    };
    const r = calculateScenario(input, rules);
    expect(Number(r.breakdown.incomeTax)).toBe(0);
  });
});