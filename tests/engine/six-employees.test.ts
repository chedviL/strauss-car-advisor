// tests/engine/six-employees.test.ts
// RT-4: רגרסיית ששת העובדים. התאמה מדויקת לשקל ל-net, tax, ni+health.
// AC-2.7.1..2.7.4. ערכי expected לעולם אינם משתנים כדי להסתיר באג.
//
// הערה על עיגול (O7, design §5.3): העיגול מתבצע על הערך המדוכן המוצג.
// עמודת "ביטוח לאומי+בריאות" בגיליון הייחוס היא הסכום המדויק של ב"ל+בריאות
// המעוגל פעם אחת לשקל - לכן משווים round(ni+health), לא round(ni)+round(health).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { calculateScenario } from "../../src/domain/calculation/engine.js";
import { parseRules } from "../../src/domain/calculation/rule-set-loader.js";
import { EMPLOYEE_CASES } from "../fixtures/employees.js";

const here = dirname(fileURLToPath(import.meta.url));
const rulesPath = join(here, "../../data/source/strauss-rules.json");
const { rules } = parseRules(readFileSync(rulesPath, "utf8"));

function round(s: string): number {
  return Math.round(Number(s));
}

describe("RT-4: ששת העובדים - התאמה מדויקת לייחוס", () => {
  for (const c of EMPLOYEE_CASES) {
    it(`${c.id} ${c.name} - ${c.label}`, () => {
      const r = calculateScenario(c.input, rules);
      const net = round(r.netExact);
      const tax = round(r.breakdown.incomeTax);
      // עיגול הסכום המשולב פעם אחת (כפי שמוצג בעמודת הייחוס):
      const niHealth = Math.round(
        Number(r.breakdown.nationalInsurance) + Number(r.breakdown.health),
      );
      expect(net, "נטו").toBe(c.expectedNet);
      expect(tax, "מס הכנסה").toBe(c.expectedTax);
      expect(niHealth, "ביטוח לאומי + בריאות").toBe(c.expectedNiHealth);
    });
  }

  it("delta של כל זוג עובד תואם להפרש הייחוסי", () => {
    const pairs: Array<[string, string, number]> = [
      ["E-001-today", "E-001-alt", 661],
      ["E-002-today", "E-002-alt", -3522],
      ["E-003-today", "E-003-alt", -1938],
      ["E-004-today", "E-004-alt", 1207],
      ["E-005-today", "E-005-alt", 3562],
      ["E-006-today", "E-006-alt", 721],
    ];
    for (const [todayId, altId, expectedDelta] of pairs) {
      const today = EMPLOYEE_CASES.find((e) => e.id === todayId)!;
      const alt = EMPLOYEE_CASES.find((e) => e.id === altId)!;
      const todayNet = round(calculateScenario(today.input, rules).netExact);
      const altNet = round(calculateScenario(alt.input, rules).netExact);
      expect(altNet - todayNet, `${todayId}->${altId}`).toBe(expectedDelta);
    }
  });
});