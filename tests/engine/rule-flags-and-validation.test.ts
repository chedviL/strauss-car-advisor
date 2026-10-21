// tests/engine/rule-flags-and-validation.test.ts
// רגרסיה לבאגי QA במנוע: (1) דגלי קובץ הכללים התעלמו (המנוע קודד קשיח),
// (2) קלט לא תקין הניב נטו שגוי בשקט (NaN / שלילי / קבוצה משפחתית ללא תקציב).
// כל ציפייה כאן נגזרת עצמאית (שקילות בין קלטים / חישוב ידני), לא מהפלט של המנוע עצמו.
// ערכי הייחוס של ששת העובדים נשארים ב-six-employees.test.ts ואינם משתנים.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { calculateScenario, InvalidInputError } from "../../src/domain/calculation/engine.js";
import { parseRules } from "../../src/domain/calculation/rule-set-loader.js";
import type { RuleSet } from "../../src/domain/contracts/types.js";
import { EMPLOYEE_CASES } from "../fixtures/employees.js";

const here = dirname(fileURLToPath(import.meta.url));
const { rules } = parseRules(readFileSync(join(here, "../../data/source/strauss-rules.json"), "utf8"));
const clone = (): RuleSet => structuredClone(rules);
const emp = (id: string) => EMPLOYEE_CASES.find((e) => e.id === id)!.input;
const net = (r: ReturnType<typeof calculateScenario>) => Number(r.netExact);

describe("דגלי הכללים נאכפים (לא מקודדים קשיח)", () => {
  it("ברירות מחדל של הקובץ: התוצאה זהה לייחוס (E-003 ויתור: 15,047)", () => {
    expect(Math.round(net(calculateScenario(emp("E-003-today"), rules)))).toBe(15047);
  });

  it("maintenanceIsTaxable=false: אחזקה היא מזומן נטו מלא = נטו בלי אחזקה + האחזקה", () => {
    const r = clone();
    r.waiver.maintenanceIsTaxable = false;
    const withMaint = calculateScenario(emp("E-003-today"), r);
    const noMaint = calculateScenario({ ...emp("E-003-today"), maintenanceAllowance: 0 }, rules);
    expect(net(withMaint)).toBeCloseTo(net(noMaint) + 1500, 2);
    // ובדיפולט (חייבת במס) הנטו נמוך יותר מהמקרה הפטור
    expect(net(calculateScenario(emp("E-003-today"), rules))).toBeLessThan(net(withMaint));
  });

  it("maintenanceIsPensionable=true: בסיס ההפרשות כולל את האחזקה (חישוב ידני)", () => {
    const r = clone();
    r.waiver.maintenanceIsPensionable = true;
    const out = calculateScenario(emp("E-003-today"), r); // שכר 21000 + אחזקה 1500, פנסיה 6.5%, קה"ש 2.5%
    expect(out.breakdown.pensionEmployee).toBe(((21000 + 1500) * 0.065).toFixed(2));
    expect(out.breakdown.trainingEmployee).toBe(((21000 + 1500) * 0.025).toFixed(2));
  });

  it("reducesValueOfUse=true: שקול לשווי שימוש מופחת בהשתתפות (ההשתתפות עדיין יורדת מהנטו)", () => {
    const r = clone();
    r.netMethod.participation.reducesValueOfUse = true;
    const input = emp("E-001-today"); // שווי שימוש 4070, השתתפות 300
    const flagged = calculateScenario(input, r);
    const equivalent = calculateScenario({ ...input, valueOfUse: 4070 - 300 }, rules);
    expect(flagged.netExact).toBe(equivalent.netExact);
    expect(flagged.breakdown.taxableIncome).toBe(equivalent.breakdown.taxableIncome);
  });

  it("reducesValueOfUse לעולם לא יוצר שווי שימוש שלילי (השתתפות > שווי)", () => {
    const r = clone();
    r.netMethod.participation.reducesValueOfUse = true;
    const out = calculateScenario({ ...emp("E-001-today"), valueOfUse: 200, participation: 900 }, r);
    const cash = Number(out.breakdown.cashSalary);
    expect(Number(out.breakdown.taxableIncome)).toBeCloseTo(cash, 2);
  });

  it("electric.method=gross_fixed: תוספת ברוטו קבועה = netBonus (ללא פתרון מספרי)", () => {
    const r = clone();
    r.electric.method = "gross_fixed";
    const out = calculateScenario(emp("E-001-alt"), r);
    expect(out.breakdown.electricGrossUp).toBe("250.00");
    expect(Number(out.breakdown.cashSalary)).toBeCloseTo(18500 + 250, 2);
  });

  it("gross_up (ברירת מחדל): ההפרש בנטו בדיוק 250 ₪", () => {
    const el = emp("E-001-alt");
    const withEl = calculateScenario(el, rules);
    const without = calculateScenario({ ...el, isElectric: false }, rules);
    expect(net(withEl) - net(without)).toBeCloseTo(250, 6);
  });

  it("rounding.display=agora: נטו לתצוגה באגורות (לא מעוגל לשקל)", () => {
    const r = clone();
    r.netMethod.rounding.display = "agora";
    const out = calculateScenario(emp("E-001-today"), r);
    expect(out.netDisplay).toMatch(/^\d+\.\d{2}$/);
    expect(out.netDisplay).toBe(out.netExact);
  });

  it("rounding.during=agora: כל רכיב כסף מעוגל לאגורה בביניים (ללא שברי אגורה)", () => {
    const r = clone();
    r.netMethod.rounding.during = "agora";
    const out = calculateScenario(emp("E-004-alt"), r);
    for (const k of ["incomeTax", "nationalInsurance", "health", "pensionEmployee", "trainingEmployee", "electricGrossUp"] as const) {
      const v = Number(out.breakdown[k]);
      expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-6);
    }
  });
});

describe("קלט לא תקין נדחה (לא נטו שגוי בשקט)", () => {
  const base = emp("E-001-today");
  it.each([
    ["baseSalary NaN", { baseSalary: NaN }, "baseSalary"],
    ["baseSalary Infinity", { baseSalary: Infinity }, "baseSalary"],
    ["baseSalary שלילי", { baseSalary: -5000 }, "baseSalary"],
    ["participation שלילי", { participation: -1 }, "participation"],
    ["pensionRate 600%", { pensionRate: 6 }, "pensionRate"],
    ["trainingRate שלילי", { trainingRate: -0.1 }, "trainingRate"],
    ["creditPoints NaN", { creditPoints: NaN }, "creditPoints"],
  ])("%s -> InvalidInputError", (_n, patch, field) => {
    try {
      calculateScenario({ ...base, ...patch }, rules);
      throw new Error("expected InvalidInputError");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidInputError);
      expect((e as InvalidInputError).field).toBe(field);
    }
  });

  it("מסלול משפחתי עם קבוצה ללא תקציב נדחה (לא 'תקציב 0' שמוריד 1,850 ₪ מהנטו)", () => {
    const fam = emp("E-002-alt");
    expect(Math.round(net(calculateScenario(fam, rules)))).toBe(5078); // ייחוס, קבוצה ב'
    expect(() => calculateScenario({ ...fam, group: "xyz" }, rules)).toThrow(InvalidInputError);
    expect(() => calculateScenario({ ...fam, group: "משפחתי" }, rules)).toThrow(InvalidInputError);
  });

  it("אפס מפורש תקין (שונה מחסר): שכר 0 ו-participation 0 מחושבים", () => {
    const out = calculateScenario({ ...base, baseSalary: 0, participation: 0, commission: 0, bonus: 0 }, rules);
    expect(Number.isFinite(Number(out.netExact))).toBe(true);
  });
});
