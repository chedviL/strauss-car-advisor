// tests/integration/pg-participation-explicit.test.ts
// מאמת ש"אותה השתתפות" נשמר כערך *מפורש* על החלופה (מועתק מהמצב הנוכחי), ולא
// null שמסתמך על ברירת מחדל מקרית. בודק גם מקרה שבו ההשתתפות הנוכחית שונה
// מברירת המחדל של החלופה - שם null ל-null *לא* היה שקול להוראת המשתמש/ת.
// ללא מודל; דרך אותו כלי (manageScenarios) שהשיחה משתמשת בו. מצב שמור.
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { sslFor } from "../../src/server/repositories/pg-ssl.js";
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { findActiveDatasetId } from "../../src/server/services/dataset-provider.js";
import { updateCurrentVehicle } from "../../src/server/agent/tools/update-current-vehicle.js";
import { manageScenarios } from "../../src/server/agent/tools/manage-scenarios.js";
import type { ToolContext } from "../../src/server/agent/tool-contracts.js";

const APP = process.env.DATABASE_URL;
const ADMIN = process.env.MIGRATION_DATABASE_URL;
const run = APP && ADMIN ? describe : describe.skip;

run("השתתפות 'אותו ערך' נשמרת מפורש (לא null/ברירת מחדל)", () => {
  let service: CaseService; let admin: Client;
  const caseIds: string[] = [];

  beforeAll(async () => {
    service = new CaseService(new PgCaseRepository(APP!));
    if (!(await findActiveDatasetId(APP!))) throw new Error("dataset לא יובא");
    admin = new Client({ connectionString: ADMIN!, ...sslFor(ADMIN!) });
    await admin.connect();
  }, 30000);

  afterAll(async () => {
    if (admin) { await admin.query("delete from cases where id = any($1)", [caseIds]).catch(() => {}); await admin.end(); }
  }, 30000);

  it("השתתפות נוכחית 450 (שונה מברירת מחדל 300) מועתקת מפורש לחלופה", { timeout: 90000 }, async () => {
    const owner = "part-exp-" + randomUUID();
    const created = await service.startBlankCase(owner);
    const caseId = created.case.id; caseIds.push(caseId);
    const ctx: ToolContext = { ownerId: owner, caseId, staffRole: null, requestId: randomUUID(), messageId: null };

    // המצב הנוכחי: קורולה קרוס עם השתתפות *450* (לא 300 שהוא ברירת המחדל של הקטלוג).
    await updateCurrentVehicle(service, ctx, { route: "company_car", vehicleCode: "CAR-09", participation: 450 });
    let st = await service.getCaseState(caseId, owner);
    const base = st!.scenarios.find((s) => s.role === "baseline")!;
    expect(base.participation).toBe(450);

    // "אותה השתתפות" -> המודל אמור להעתיק 450 מפורשות. מדמים את הפעולה הנכונה:
    await manageScenarios(service, ctx, {
      operation: "set_alternative", route: "company_car", vehicleCode: "CAR-10",
      participation: base.participation,  // העתקה מפורשת מהמצב הנוכחי
    });
    st = await service.getCaseState(caseId, owner);
    const alt = st!.scenarios.find((s) => s.role === "alternative")!;
    // נשמר הערך המפורש 450 - *לא* null ולא 300 (ברירת המחדל של CAR-10).
    expect(alt.participation).toBe(450);
    expect(alt.participation).not.toBeNull();
    expect(alt.vehicleCode).toBe("CAR-10");
  });
});
