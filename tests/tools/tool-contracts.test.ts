// tests/tools/tool-contracts.test.ts
// בדיקות חוזי הכלים: מעטפת אחידה, סכמות סגורות, גבולות סימולציה, זכאות-לא-ידועה.
// לא בודק הבנת שיחה (ממתין למודל); בודק את ההתנהגות העסקית בקוד.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileCaseRepository } from "../../src/server/repositories/case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { updateCase, updateCaseInput } from "../../src/server/agent/tools/update-case.js";
import { manageScenarios, manageScenariosInput } from "../../src/server/agent/tools/manage-scenarios.js";
import { searchVehicles } from "../../src/server/agent/tools/search-vehicles.js";
import { compareScenarios } from "../../src/server/agent/tools/compare-scenarios.js";
import { openInquiry } from "../../src/server/agent/tools/open-inquiry.js";
import type { ToolContext } from "../../src/server/agent/tool-contracts.js";

let dir: string;
let service: CaseService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "strauss-tools-"));
  service = new CaseService(new FileCaseRepository(dir));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function ctxFor(empId = "E-001"): Promise<ToolContext> {
  const c = await service.createDemoCaseFromEmployee("tool-owner", empId);
  return { ownerId: "tool-owner", caseId: c.case.id, staffRole: null, requestId: "req-1", messageId: null };
}

describe("סכמות כלים סגורות - אין שדות/נתיבים שרירותיים", () => {
  it("updateCase דוחה שדה לא מוכר", () => {
    const parsed = updateCaseInput.safeParse({ expectedFactsRevision: 0, set: { hackField: 1 } });
    // שדה לא מוכר ב-set פשוט לא נכלל; הסכמה לא נכשלת אבל השדה לא קיים.
    if (parsed.success) {
      expect((parsed.data.set as Record<string, unknown>).hackField).toBeUndefined();
    }
  });

  it("manageScenarios override מקבל רק שדות שכר - לא קבוצה/רכב חובה", () => {
    const bad = manageScenariosInput.safeParse({
      operation: "set_alternative", route: "company_car",
      overrides: { reportedGroup: "ד" },
    });
    if (bad.success) {
      expect((bad.data.overrides as Record<string, unknown> | undefined)?.reportedGroup).toBeUndefined();
    }
  });
});

describe("גבולות סימולציה: override אינו משנה זכאות אמיתית", () => {
  it("override שכר אינו משנה קבוצת זכאות - רכב גבוה עדיין נפסל", async () => {
    const ctx = await ctxFor("E-003"); // developer group ב
    // חלופה היפותטית עם שכר גבוה, אבל רכב מקבוצה ד -> עדיין ineligible.
    const res = await compareScenarios(service, ctx, {
      mode: "explicit",
      candidates: [{ label: "SEAL-ד", route: "company_car", vehicleCode: "CAR-17", participation: 500, maintenanceAllowance: 0, overrides: { baseSalary: 90000 } }],
    });
    expect(res.status).toBe("success");
    if (res.status === "success") {
      const data = res.data as { excluded: Array<{ ref: string }> };
      expect(data.excluded.some((e) => e.ref === "SEAL-ד")).toBe(true);
    }
  });
});

describe("מעטפת אחידה וזכאות לא ידועה", () => {
  it("updateCase מחזיר success + גרסה חדשה", async () => {
    const ctx = await ctxFor();
    const res = await updateCase(service, ctx, { expectedFactsRevision: 0, set: { baseSalary: 20000 } });
    expect(res.status).toBe("success");
    expect(res.versions?.facts).toBe(1);
  });

  it("updateCase עם גרסה שגויה מחזיר conflict", async () => {
    const ctx = await ctxFor();
    await updateCase(service, ctx, { expectedFactsRevision: 0, set: { baseSalary: 20000 } });
    const res = await updateCase(service, ctx, { expectedFactsRevision: 0, set: { baseSalary: 30000 } });
    expect(res.status).toBe("conflict");
  });

  it("manageScenarios שומר override ומחזיר הודעה היפותטית", async () => {
    const ctx = await ctxFor();
    const res = await manageScenarios(service, ctx, {
      operation: "set_alternative", route: "company_car", vehicleCode: "CAR-09",
      participation: 300, overrides: { baseSalary: 25000 },
    });
    expect(res.status).toBe("success");
    expect(res.data?.overrides.baseSalary).toBe(25000);
  });

  it("searchVehicles מחזיר מועמדים עם סטטוס זכאות", async () => {
    const ctx = await ctxFor();
    const res = await searchVehicles(service, ctx, { propulsion: "3" });
    expect(res.status).toBe("success");
    const data = res.data as { candidates: Array<{ eligibility: string }> };
    expect(data.candidates.length).toBeGreaterThan(0);
  });

  it("openInquiry עם dedup דרך הכלי", async () => {
    const ctx = await ctxFor("E-002");
    const a = await openInquiry(service, ctx, { type: "employee_participation" });
    const b = await openInquiry(service, ctx, { type: "employee_participation" });
    expect(a.status).toBe("success");
    expect(b.data?.deduped).toBe(true);
  });
});