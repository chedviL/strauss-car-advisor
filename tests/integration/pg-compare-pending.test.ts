// tests/integration/pg-compare-pending.test.ts
// מאמת ש-compareScenarios (הכלי של מסלול B) שומר בקשת השוואה עמידה כשנעצר על
// חוסר-נתונים, ומנקה אותה בהצלחה - דרך השירות המשותף (setPendingRequest). כך
// המודל יכול להמשיך את ההשוואה אחרי השלמת החוסר, בלי שהמשתמש/ת יבקש שוב.
// ללא מודל. בודק מצב שנשמר, לא טקסט.
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { sslFor } from "../../src/server/repositories/pg-ssl.js";
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { findActiveDatasetId } from "../../src/server/services/dataset-provider.js";
import { compareScenarios } from "../../src/server/agent/tools/compare-scenarios.js";
import type { ToolContext } from "../../src/server/agent/tool-contracts.js";

const APP = process.env.DATABASE_URL;
const ADMIN = process.env.MIGRATION_DATABASE_URL;
const run = APP && ADMIN ? describe : describe.skip;

run("compareScenarios: בקשה ממתינה נשמרת בחוסר ומתנקה בהצלחה (מסלול B)", () => {
  let service: CaseService; let admin: Client;
  const caseIds: string[] = [];

  beforeAll(async () => {
    service = new CaseService(new PgCaseRepository(APP!));
    if (!(await findActiveDatasetId(APP!))) throw new Error("dataset לא יובא");
    admin = new Client({ connectionString: ADMIN!, ...sslFor(ADMIN!) });
    await admin.connect();
  }, 30000);

  afterAll(async () => {
    if (admin) {
      await admin.query("delete from cases where id = any($1)", [caseIds]).catch(() => {});
      await admin.end();
    }
  }, 30000);

  it("חוסר -> pendingRequest נשמר; השלמה -> נקרא ומתנקה", { timeout: 90000 }, async () => {
    const owner = "cmp-pending-" + randomUUID();
    const created = await service.startBlankCase(owner);
    const caseId = created.case.id; caseIds.push(caseId);
    const ctx: ToolContext = { ownerId: owner, caseId, staffRole: null, requestId: randomUUID(), messageId: null };

    // אין עדיין שכר -> baseline חסר נתונים לחישוב נטו.
    const r1 = await compareScenarios(service, ctx, {
      mode: "explicit",
      candidates: [{ label: "ATTO 3", route: "company_car", vehicleCode: "CAR-10", participation: 300, maintenanceAllowance: 0 }],
    });
    expect(r1.status).toBe("missing_data");
    // הבקשה נשמרה כפעילה (עמידה).
    let st = await service.getCaseState(caseId, owner);
    expect(st!.case.pendingRequest).not.toBeNull();
    expect(st!.case.pendingRequest!.kind).toBe("compare");
    expect(st!.case.pendingRequest!.mode).toBe("explicit");
    expect(st!.case.pendingRequest!.vehicleCodes).toContain("CAR-10");

    // משלימים את החוסר: עובדות + baseline, ואז משווים שוב -> הצלחה וניקוי.
    await service.updateFacts(caseId, owner, {
      baseSalary: 18500, commission: 0, bonus: 0, pensionRate: 0.06, trainingRate: 0.025,
      creditPoints: 2.75, qualifyingChildren: 0, occupationCode: "product_manager", reportedGroup: "ג",
    } as never, st!.case.factsRevision);
    await service.updateBaselineVehicle(caseId, owner, { route: "company_car", vehicleCode: "CAR-09", participation: 300, maintenanceAllowance: 0 });

    const r2 = await compareScenarios(service, ctx, {
      mode: "explicit",
      candidates: [{ label: "ATTO 3", route: "company_car", vehicleCode: "CAR-10", participation: 300, maintenanceAllowance: 0 }],
    });
    expect(r2.status).toBe("success");
    // הבקשה הממתינה נוקתה (הושלמה).
    st = await service.getCaseState(caseId, owner);
    expect(st!.case.pendingRequest).toBeNull();
  });
});
