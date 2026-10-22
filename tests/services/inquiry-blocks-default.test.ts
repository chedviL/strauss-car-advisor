// tests/services/inquiry-blocks-default.test.ts
// בדיקה ממוקדת: בחירה להמתין לנציג אינה הסכמה לחישוב לפי הנחה.
// תרחיש: פנייה פתוחה על השתתפות → compareScenarios לא מחשב את המועמד (incomplete).
// מענה תקף (600 ₪) → השוואה מעודכנת עם 600 ₪.
// מענה מיושן (stale_context) → לא מוחל, ההשוואה לא מתעדכנת.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileCaseRepository } from "../../src/server/repositories/case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";

let dir: string;
let service: CaseService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "strauss-inq-block-"));
  service = new CaseService(new FileCaseRepository(dir));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** יוצר תיק עם baseline (COROLLA CROSS) + חלופה (CAR-10, participation=null) + פנייה פתוחה. */
async function setupWaitingForRep(owner: string) {
  const state = await service.createDemoCaseFromEmployee(owner, "E-001");
  const caseId = state.case.id;

  const baselineVehicle = state.scenarios.find((s) => s.role === "baseline")!;
  // חלופה עם participation=null (לא ידוע — ממתין לנציג)
  const alt = await service.pickAlternative(caseId, owner, {
    role: "alternative",
    route: "company_car",
    vehicleCode: "CAR-10",
    participation: null,
    maintenanceAllowance: 0,
  });

  // פנייה לנציג על ההשתתפות של החלופה
  const cur = await service.getCaseState(caseId, owner);
  const { inquiry } = await service.openInquiry(
    caseId, owner, "employee_participation", alt.id,
    {
      type: "employee_participation",
      route: alt.route,
      vehicle: alt.vehicleCode ?? "",
      group: cur!.facts.reportedGroup ?? "",
      factsRevision: cur!.case.factsRevision,
    },
  );

  return { caseId, altId: alt.id, inquiryId: inquiry.id, baselineId: baselineVehicle.id };
}

describe("פנייה פתוחה חוסמת חישוב עם ברירת מחדל", () => {
  it("compareScenarios: מועמד עם פנייה פתוחה נמצא ב-incomplete (לא מחשב עם ברירת מחדל)", async () => {
    const owner = "inq-block-1";
    const { caseId } = await setupWaitingForRep(owner);

    const result = await service.compareScenarios(caseId, owner, {
      mode: "explicit",
      candidates: [
        {
          label: "CAR-10",
          route: "company_car",
          vehicleCode: "CAR-10",
          participation: null, // לא ידוע
          maintenanceAllowance: 0,
        },
      ],
    });

    // status=ok (baseline הצליח), אבל המועמד ב-incomplete — לא חושב עם ברירת מחדל
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.comparisons).toHaveLength(0);
      expect(
        result.incomplete.some(
          (i) => i.label === "CAR-10" && i.missingFields.includes("participation"),
        ),
      ).toBe(true);
    }
  });

  it("computeAndSaveComparison מחזיר missing_data כשיש פנייה פתוחה על החלופה", async () => {
    const owner = "inq-block-2";
    const { caseId } = await setupWaitingForRep(owner);

    const result = await service.computeAndSaveComparison(caseId, owner);
    expect(result.status).toBe("missing_data");
    expect((result as { missingFields?: string[] }).missingFields).toContain("participation");
  });

  it("מענה תקף (600 ₪) → ההשתתפות מוחלת → השוואה מחושבת מחדש עם 600 ₪", async () => {
    const owner = "inq-block-3";
    const { caseId, altId, inquiryId } = await setupWaitingForRep(owner);

    const res = await service.answerAndApplyInquiry(inquiryId, owner, {
      value: 600,
      note: null,
      effectiveFrom: null,
    });

    expect(res.status).toBe("applied");
    expect(res.recomputed).toBe(true);

    const after = await service.getCaseState(caseId, owner);
    const altAfter = after!.scenarios.find((s) => s.id === altId);
    expect(altAfter!.participation).toBe(600);
    expect(after!.latestComparison).not.toBeNull();
    const inq = after!.openInquiries.find((q) => q.id === inquiryId);
    expect(inq!.status).toBe("answered");
    expect(inq!.answerValue).toBe(600);
    // אין פניות פתוחות שחוסמות חישוב
    const stillBlocking = after!.openInquiries.filter(
      (q) => q.status === "open" && q.type === "employee_participation" && q.scenarioId === altId,
    );
    expect(stillBlocking).toHaveLength(0);
  });

  it("מענה מיושן (stale_context): נרשם אך לא מוחל, ההשוואה לא מתעדכנת", async () => {
    const owner = "inq-block-4";
    const { caseId, altId, inquiryId } = await setupWaitingForRep(owner);

    // משנים עובדה → factsRevision עולה → ההקשר של הפנייה מתיישן
    const cur = await service.getCaseState(caseId, owner);
    await service.updateFacts(caseId, owner, { baseSalary: 20000 }, cur!.case.factsRevision);

    const res = await service.answerAndApplyInquiry(inquiryId, owner, {
      value: 600,
      note: null,
      effectiveFrom: null,
    });

    expect(res.status).toBe("stale_context");

    const after = await service.getCaseState(caseId, owner);
    const altAfter = after!.scenarios.find((s) => s.id === altId);
    expect(altAfter!.participation).toBeNull();
    expect(after!.latestComparison).toBeNull();
    const inq = after!.openInquiries.find((q) => q.id === inquiryId);
    expect(inq!.status).toBe("answered");
    expect(inq!.answerValue).toBe(600);
  });
});
