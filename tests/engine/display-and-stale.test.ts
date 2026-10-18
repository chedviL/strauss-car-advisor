// tests/engine/display-and-stale.test.ts
// פערי כיסוי ממוקדים: עיגול לתצוגה (netDisplay שלם מתוך netExact) וחיווי
// תוצאה מיושנת ב-buildContext כשגרסת העובדות השתנתה מאז החישוב.
// ללא שינוי ערכי ייחוס/כללים.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { calculateScenario } from "../../src/domain/calculation/engine.js";
import { parseRules } from "../../src/domain/calculation/rule-set-loader.js";
import { buildContext } from "../../src/server/agent/context.js";
import type { CaseState } from "../../src/domain/contracts/case.js";
import type { CompleteInput } from "../../src/domain/contracts/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const { rules } = parseRules(readFileSync(join(here, "../../data/source/strauss-rules.json"), "utf8"));

const baseInput: CompleteInput = {
  route: "company_car", group: "ג",
  baseSalary: 18500, commission: 0, bonus: 0,
  pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.75,
  valueOfUse: 4070, isElectric: false, participation: 300,
  companyCarCost: 4300, maintenanceAllowance: 0,
};

describe("עיגול לתצוגה", () => {
  it("netDisplay הוא מספר שלם (ללא אגורות), netExact שומר דיוק מלא", () => {
    const r = calculateScenario(baseInput, rules);
    // netDisplay מעוגל לשקל
    expect(r.netDisplay).toMatch(/^\d+$/); // ללא נקודה עשרונית
    expect(Number.isInteger(Number(r.netDisplay))).toBe(true);
    // netExact עם שתי ספרות עשרוניות (דיוק מלא לפני עיגול)
    expect(r.netExact).toMatch(/^\d+\.\d{2}$/);
    // העיגול תואם Math.round של הערך המדויק
    expect(Number(r.netDisplay)).toBe(Math.round(Number(r.netExact)));
  });

  it("סריקת שכר על גבולות מדרגות: netDisplay תמיד שלם ואי-שלילי", () => {
    for (const salary of [5000, 6790, 9730, 15800, 21710, 45180, 58190, 80000]) {
      const r = calculateScenario({ ...baseInput, baseSalary: salary }, rules);
      expect(r.netDisplay).toMatch(/^\d+$/);
      expect(Number(r.netDisplay)).toBeGreaterThanOrEqual(0);
      expect(Number(r.breakdown.incomeTax)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("חיווי תוצאה מיושנת ב-buildContext", () => {
  function stateWith(cmpRevision: number, currentRevision: number): CaseState {
    return {
      case: { id: "c1", ownerId: "o1", isDemo: true, datasetId: "d1", status: "active", factsRevision: currentRevision, pendingRequest: null, createdAt: "", updatedAt: "" },
      facts: { occupationCode: "product_manager", reportedGroup: "ג", baseSalary: 18500, commission: 0, bonus: 0, pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.75, qualifyingChildren: 2 },
      scenarios: [],
      latestComparison: {
        id: "cmp1", factsRevision: cmpRevision, ruleSetHash: "h", completedAt: "2026-01-01T10:00:00.000Z",
        result: { baseline: { netDisplay: "11032" }, alternative: { netDisplay: "11693" }, netDeltaDisplay: 661 },
      } as unknown as CaseState["latestComparison"],
      openInquiries: [],
    } as unknown as CaseState;
  }

  it("גרסה תואמת -> מסומנת עדכנית", () => {
    const ctx = buildContext(stateWith(3, 3));
    expect(ctx).toContain("עדכנית");
    expect(ctx).not.toContain("מיושנת");
  });

  it("גרסת החישוב ישנה מהנוכחית -> מסומנת מיושנת (לא להציג כעדכנית)", () => {
    const ctx = buildContext(stateWith(2, 3));
    expect(ctx).toContain("מיושנת");
  });
});