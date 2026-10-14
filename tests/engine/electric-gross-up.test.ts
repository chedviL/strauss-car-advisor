// tests/engine/electric-gross-up.test.ts
// בדיקת גילום החזר חשמל: תוספת הברוטו מניבה הפרש נטו של בדיוק +250 ₪
// לפני עיגול לתצוגה. AC-2.3.1..2.3.3. גם במעברי מדרגה/תקרה.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  calculateScenario,
  electricNetDelta,
} from "../../src/domain/calculation/engine.js";
import { parseRules } from "../../src/domain/calculation/rule-set-loader.js";
import type { CompleteInput } from "../../src/domain/contracts/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const { rules } = parseRules(
  readFileSync(join(here, "../../data/source/strauss-rules.json"), "utf8"),
);

function base(overrides: Partial<CompleteInput>): CompleteInput {
  return {
    route: "company_car", group: "ג",
    baseSalary: 15000, commission: 0, bonus: 0,
    pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.25,
    valueOfUse: 3000, isElectric: true, participation: 0,
    companyCarCost: 4000, maintenanceAllowance: 0,
    ...overrides,
  };
}

describe("גילום החזר חשמל", () => {
  // טווח רחב של שכרים כדי לכסות מדרגות מס שונות וחציית תקרות ב"ל.
  const salaries = [8000, 12000, 15000, 20000, 30000, 48000, 55000, 70000];

  for (const s of salaries) {
    it(`הפרש נטו = בדיוק 250 ₪ בשכר ${s}`, () => {
      const input = base({ baseSalary: s });
      const { netDelta } = electricNetDelta(input, rules);
      // סובלנות של אגורה בודדת (הפתרון המספרי חסום)
      expect(Math.abs(Number(netDelta) - 250)).toBeLessThan(0.01);
    });
  }

  it("אין הוספת 250 כפולה: נטו חשמלי = נטו לא-חשמלי + גילום הנטו (≈250)", () => {
    const electric = base({ isElectric: true });
    const petrol = base({ isElectric: false });
    const netE = Number(calculateScenario(electric, rules).netExact);
    const netP = Number(calculateScenario(petrol, rules).netExact);
    expect(Math.abs(netE - netP - 250)).toBeLessThan(0.01);
  });

  it("רכב לא-חשמלי אינו מקבל גילום", () => {
    const r = calculateScenario(base({ isElectric: false }), rules);
    expect(Number(r.breakdown.electricGrossUp)).toBe(0);
  });

  it("גילום קיים ברכב חשמלי וגדול מ-250 (כי הוא ברוטו חייב במס)", () => {
    const r = calculateScenario(base({ isElectric: true }), rules);
    expect(Number(r.breakdown.electricGrossUp)).toBeGreaterThan(250);
  });
});