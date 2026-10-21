// tests/engine/staleness.test.ts
// רגרסיה: "השוואה עדכנית" נקבעה לפי גרסת עובדות בלבד. שינוי רכב נוכחי / השתתפות /
// סימולציה (גרסת תרחיש) לא סימן אותה כמיושנת, והמודל ציטט מספר ישן כעדכני.
import { describe, it, expect } from "vitest";
import { isComparisonStale } from "../../src/domain/calculation/staleness.js";
import type { CaseState, Scenario } from "../../src/domain/contracts/case.js";

function state(opts: { factsRev?: number; cmpFactsRev?: number; baseRev?: number; altRev?: number; snapBaseRev?: number; snapAltRev?: number; noAlt?: boolean }): Pick<CaseState, "case" | "scenarios" | "latestComparison"> {
  const scen = (id: string, role: "baseline" | "alternative", revision: number): Scenario =>
    ({ id, caseId: "c", role, route: "company_car", vehicleCode: "CAR-09", participation: 300, maintenanceAllowance: 0, overrides: {}, revision });
  return {
    case: { factsRevision: opts.factsRev ?? 1 } as CaseState["case"],
    scenarios: [scen("b", "baseline", opts.baseRev ?? 0), ...(opts.noAlt ? [] : [scen("a", "alternative", opts.altRev ?? 0)])],
    latestComparison: {
      id: "cmp", caseId: "c", baselineScenarioId: "b", alternativeScenarioId: "a",
      ruleSetHash: "h", factsRevision: opts.cmpFactsRev ?? 1, completedAt: "",
      inputSnapshot: { baseline: scen("b", "baseline", opts.snapBaseRev ?? 0), alternative: scen("a", "alternative", opts.snapAltRev ?? 0) },
      result: {} as never,
    },
  };
}

describe("isComparisonStale", () => {
  it("אין השוואה -> לא מיושנת", () => {
    expect(isComparisonStale({ ...state({}), latestComparison: null })).toBe(false);
  });
  it("הכול תואם -> עדכנית", () => {
    expect(isComparisonStale(state({}))).toBe(false);
  });
  it("גרסת עובדות השתנתה -> מיושנת", () => {
    expect(isComparisonStale(state({ factsRev: 2, cmpFactsRev: 1 }))).toBe(true);
  });
  it("רכב/השתתפות נוכחיים השתנו (baseline revision) -> מיושנת", () => {
    expect(isComparisonStale(state({ baseRev: 1, snapBaseRev: 0 }))).toBe(true);
  });
  it("החלופה/סימולציה השתנו (alternative revision) -> מיושנת", () => {
    expect(isComparisonStale(state({ altRev: 3, snapAltRev: 2 }))).toBe(true);
  });
  it("התרחיש שבו חושבה ההשוואה נעלם -> מיושנת", () => {
    expect(isComparisonStale(state({ noAlt: true }))).toBe(true);
  });
});
