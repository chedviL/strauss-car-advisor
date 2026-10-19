// tests/integration/pg-search-multi.test.ts
// מאמת שחיפוש כמה רכבים בקריאה אחת (names[]) מזהה כל אחד בנפרד - חוסך סבב ספק
// בלי לוותר על זיהוי מדויק. ללא מודל. דרך אותו כלי שהשיחה משתמשת בו.
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { sslFor } from "../../src/server/repositories/pg-ssl.js";
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { findActiveDatasetId } from "../../src/server/services/dataset-provider.js";
import { searchVehicles } from "../../src/server/agent/tools/search-vehicles.js";
import type { ToolContext } from "../../src/server/agent/tool-contracts.js";

const APP = process.env.DATABASE_URL;
const ADMIN = process.env.MIGRATION_DATABASE_URL;
const run = APP && ADMIN ? describe : describe.skip;

run("searchVehicles: זיהוי כמה שמות בקריאה אחת", () => {
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

  it("names=[COROLLA CROSS, ATTO 3] -> שני found עם הקודים הנכונים", { timeout: 60000 }, async () => {
    const owner = "search-multi-" + randomUUID();
    const created = await service.startBlankCase(owner);
    const caseId = created.case.id; caseIds.push(caseId);
    // צריך קבוצת זכאות כדי לחשב זכאות בחיפוש.
    let st = await service.getCaseState(caseId, owner);
    await service.updateFacts(caseId, owner, { reportedGroup: "ג" } as never, st!.case.factsRevision);
    const ctx: ToolContext = { ownerId: owner, caseId, staffRole: null, requestId: randomUUID(), messageId: null };

    const r = await searchVehicles(service, ctx, { names: ["COROLLA CROSS", "ATTO 3"] });
    expect(r.status).toBe("success");
    const data = r.data as { status: string; results: Array<{ nameQuery: string; status: string; vehicleCode?: string }> };
    expect(data.status).toBe("multi");
    expect(data.results).toHaveLength(2);
    const byName = Object.fromEntries(data.results.map((x) => [x.nameQuery, x]));
    expect(byName["COROLLA CROSS"].status).toBe("found");
    expect(byName["COROLLA CROSS"].vehicleCode).toBe("CAR-09");
    expect(byName["ATTO 3"].status).toBe("found");
    expect(byName["ATTO 3"].vehicleCode).toBe("CAR-10");
  });
});
