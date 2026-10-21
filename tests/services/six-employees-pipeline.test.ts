// tests/services/six-employees-pipeline.test.ts
// בדיקת קצה-לקצה של *הצינור האמיתי* (שירות -> פתרון קלט מהקטלוג/CSV -> מנוע), לא רק המנוע
// עם קלט ידני: ששת עובדי הייחוס מתחילים בדמו-פלואו ומתקבלים נטו היום/אחרי והפרש כבגיליון.
// הערכים הצפויים מגיליון הייחוס של האתגר ואינם משתנים כדי להתאים לקוד.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileCaseRepository } from "../../src/server/repositories/case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";

let dir: string;
let service: CaseService;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "strauss-e2e-"));
  service = new CaseService(new FileCaseRepository(dir));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const REFERENCE: Array<[string, number, number, number]> = [
  ["E-001", 11032, 11693, 661],
  ["E-002", 8600, 5078, -3522],
  ["E-003", 15047, 13109, -1938],
  ["E-004", 10693, 11900, 1207],
  ["E-005", 14244, 17806, 3562],
  ["E-006", 17073, 17794, 721],
];

describe("ששת העובדים דרך הצינור המלא", () => {
  for (const [id, today, after, delta] of REFERENCE) {
    it(`${id}: ${today} -> ${after} (Δ ${delta})`, async () => {
      const state = await service.startDemoFlow(`e2e-${id}`, id);
      const cmp = state.latestComparison!;
      expect(cmp).not.toBeNull();
      expect(Number(cmp.result.baseline.netDisplay)).toBe(today);
      expect(Number(cmp.result.alternative.netDisplay)).toBe(after);
      expect(cmp.result.netDeltaDisplay).toBe(delta);
    });
  }

  it("השוואה (compareScenarios) נותנת את אותם מספרים כמו הצינור הישיר", async () => {
    const st = await service.createDemoCaseFromEmployee("e2e-cmp", "E-004");
    const res = await service.compareScenarios(st.case.id, "e2e-cmp", {
      mode: "explicit",
      candidates: [{ label: "EV3", route: "company_car", vehicleCode: "CAR-11", participation: 300, maintenanceAllowance: 0 }],
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.baseline.net).toBe(10693);
    expect(res.comparisons[0]!.net).toBe(11900);
  });
});
