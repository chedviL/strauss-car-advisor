// tests/services/case-flow.test.ts
// חתך שירות מלא (file repo): יצירה → חלופה → חישוב+שמירה → שחזור → בידוד.
// REQ-3.1, REQ-3.2, REQ-4.2. אימות isolation ו-restore ברמת השירות.
// הערה: זהו אימות מול אחסון קבצים (לא Postgres). בדיקות RLS מול Postgres
// נמצאות ב-tests/integration (ממתינות לחיבור DATABASE_URL).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileCaseRepository } from "../../src/server/repositories/case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";

let dir: string;
let service: CaseService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "strauss-state-"));
  service = new CaseService(new FileCaseRepository(dir));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("חתך עובד (file repo): יצירה → חלופה → חישוב → שחזור", () => {
  it("E-001: יוצר תיק, בוחר חלופה חשמלית, מחשב ושומר השוואה עם delta נכון", async () => {
    const owner = "visit-aaa";
    const state = await service.createDemoCaseFromEmployee(owner, "E-001");
    expect(state.case.isDemo).toBe(true);
    expect(state.scenarios.filter((s) => s.role === "baseline")).toHaveLength(1);

    await service.pickAlternative(state.case.id, owner, {
      role: "alternative", route: "company_car",
      vehicleCode: "CAR-10", participation: 300, maintenanceAllowance: 0,
    });

    const res = await service.computeAndSaveComparison(state.case.id, owner);
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(Number(res.comparison.result.baseline.netDisplay)).toBe(11032);
      expect(Number(res.comparison.result.alternative.netDisplay)).toBe(11693);
      expect(res.comparison.result.netDeltaDisplay).toBe(661);
    }
  });

  it("רענון: טעינת מצב התיק משחזרת baseline, חלופה וההשוואה האחרונה", async () => {
    const owner = "visit-bbb";
    const created = await service.createDemoCaseFromEmployee(owner, "E-002");
    await service.pickAlternative(created.case.id, owner, {
      role: "alternative", route: "family",
      vehicleCode: "CAR-19", participation: 500, maintenanceAllowance: 0,
    });
    await service.computeAndSaveComparison(created.case.id, owner);

    const fresh = new CaseService(new FileCaseRepository(dir));
    const restored = await fresh.getCaseState(created.case.id, owner);
    expect(restored).not.toBeNull();
    expect(restored!.scenarios.some((s) => s.role === "alternative")).toBe(true);
    expect(restored!.latestComparison).not.toBeNull();
    expect(restored!.latestComparison!.result.alternative.netDisplay).toBe("5078");
  });

  it("בידוד: ביקור אחר אינו יכול לגשת לתיק (מחזיר null)", async () => {
    const caseA = await service.createDemoCaseFromEmployee("visit-A", "E-006");
    expect(await service.getCaseState(caseA.case.id, "visit-B")).toBeNull();
    expect(await service.getCaseState(caseA.case.id, "visit-A")).not.toBeNull();
  });

  it("בידוד כתיבה: ביקור אחר אינו יכול להוסיף חלופה לתיק של אחר", async () => {
    const caseA = await service.createDemoCaseFromEmployee("visit-A2", "E-004");
    await expect(
      service.pickAlternative(caseA.case.id, "visit-B2", {
        role: "alternative", route: "company_car",
        vehicleCode: "CAR-11", participation: 300, maintenanceAllowance: 0,
      }),
    ).rejects.toThrow();
  });

  it("השוואה שמורה אינה משתנה: חישוב חוזר מוסיף רשומה חדשה", async () => {
    const owner = "visit-ccc";
    const c = await service.createDemoCaseFromEmployee(owner, "E-003");
    await service.pickAlternative(c.case.id, owner, {
      role: "alternative", route: "company_car",
      vehicleCode: "CAR-06", participation: 250, maintenanceAllowance: 0,
    });
    const r1 = await service.computeAndSaveComparison(c.case.id, owner);
    const r2 = await service.computeAndSaveComparison(c.case.id, owner);
    if (r1.status === "ok" && r2.status === "ok") {
      expect(r1.comparison.id).not.toBe(r2.comparison.id);
      expect(r1.comparison.result.alternative.netDisplay).toBe("13109");
    }
  });
});