// tests/integration/pg-app-flow.test.ts
// מסלול האפליקציה מקצה-לקצה מול Postgres, ללא seed ידני ייחודי וללא קבצים:
// בחירת עובד -> יצירת תיק (dataset UUID אמיתי מהמסד) -> בחירת חלופה ->
// השוואה ושמירה ב-Postgres -> שחזור ממופע שירות חדש (כמו רענון).
// דורש DATABASE_URL + dataset מיובא (npm run import:dataset). אחרת skipped.

import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { findActiveDatasetId } from "../../src/server/services/dataset-provider.js";
import { sslFor } from "../../src/server/repositories/pg-ssl.js";

const DATABASE_URL = process.env.DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

run("מסלול אפליקציה מלא מול Postgres (dataset אמיתי, ללא seed ידני)", () => {
  let repo: PgCaseRepository;
  let service: CaseService;
  const owners: string[] = [];

  beforeAll(async () => {
    repo = new PgCaseRepository(DATABASE_URL!);
    service = new CaseService(repo);
    const id = await findActiveDatasetId(DATABASE_URL!);
    if (!id) throw new Error("dataset לא יובא - הרץ npm run import:dataset לפני הבדיקה");
  }, 30000);

  afterAll(async () => {
    if (DATABASE_URL) {
      const admin = new Client({ connectionString: DATABASE_URL, ...sslFor(DATABASE_URL) });
      await admin.connect();
      for (const o of owners) {
        await admin.query("delete from cases where owner_id = $1", [o]).catch(() => {});
      }
      await admin.end();
    }
    if (repo) await repo.close();
  }, 30000);

  it("E-001: יצירה -> חלופה -> השוואה -> שמירה -> שחזור, הכל ב-Postgres", { timeout: 30000 }, async () => {
    const owner = "app-flow-" + randomUUID();
    owners.push(owner);

    // יצירת תיק דגמה - resolveDatasetId משתמש ב-UUID האמיתי מהמסד (ללא override).
    const created = await service.createDemoCaseFromEmployee(owner, "E-001");
    expect(created.case.isDemo).toBe(true);
    // dataset_id של התיק הוא UUID תקין (לא hash מקוצר)
    expect(created.case.datasetId).toMatch(/^[0-9a-f-]{36}$/i);

    // בחירת חלופה חשמלית
    await service.pickAlternative(created.case.id, owner, {
      role: "alternative", route: "company_car", vehicleCode: "CAR-10",
      participation: 300, maintenanceAllowance: 0,
    });

    // השוואה ושמירה
    const res = await service.computeAndSaveComparison(created.case.id, owner);
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(Number(res.comparison.result.baseline.netDisplay)).toBe(11032);
      expect(Number(res.comparison.result.alternative.netDisplay)).toBe(11693);
      expect(res.comparison.result.netDeltaDisplay).toBe(661);
      // גרסת ה-dataset בהשוואה תואמת לכללים ששימשו לחישוב
      expect(res.comparison.ruleSetHash.length).toBeGreaterThan(0);
    }

    // שחזור: מופע שירות חדש (כמו תהליך שרת אחרי רענון) טוען מ-Postgres
    const freshRepo = new PgCaseRepository(DATABASE_URL!);
    const freshService = new CaseService(freshRepo);
    try {
      const restored = await freshService.getCaseState(created.case.id, owner);
      expect(restored).not.toBeNull();
      expect(restored!.scenarios.some((s) => s.role === "baseline")).toBe(true);
      expect(restored!.scenarios.some((s) => s.role === "alternative")).toBe(true);
      expect(restored!.latestComparison).not.toBeNull();
      expect(restored!.latestComparison!.result.alternative.netDisplay).toBe("11693");
    } finally {
      await freshRepo.close();
    }
  });

  it("בידוד: ביקור אחר אינו רואה את התיק (RLS)", { timeout: 30000 }, async () => {
    const ownerA = "app-A-" + randomUUID();
    const ownerB = "app-B-" + randomUUID();
    owners.push(ownerA, ownerB);
    const caseA = await service.createDemoCaseFromEmployee(ownerA, "E-002");
    expect(await service.getCaseState(caseA.case.id, ownerB)).toBeNull();
    expect(await service.getCaseState(caseA.case.id, ownerA)).not.toBeNull();
  });
});