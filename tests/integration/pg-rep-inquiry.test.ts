// tests/integration/pg-rep-inquiry.test.ts
// אימות זרימת מסך הנציג מול Postgres אמיתי (Supabase) עם RLS:
// פתיחת פנייה -> מענה נציג + החלה + חישוב מחדש בצד השרת -> שחזור ממופע שירות
// חדש (כמו רענון של העובד/ת) -> רואים תשובה ותוצאה מעודכנת.
// בנוסף: בידוד בעלות (RLS), החלה-אם-רלוונטי, תחולה עתידית.
// רץ רק כאשר DATABASE_URL מוגדר (נטען מ-.env.local ע"י tests/setup/env.ts); אחרת skipped.

import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { sslFor } from "../../src/server/repositories/pg-ssl.js";
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { findActiveDatasetId } from "../../src/server/services/dataset-provider.js";

const DATABASE_URL = process.env.DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

run("מסך נציג מול Postgres: מענה -> החלה -> חישוב מחדש -> שחזור", () => {
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

  async function setup(owner: string) {
    owners.push(owner);
    const created = await service.createDemoCaseFromEmployee(owner, "E-001");
    const caseId = created.case.id;
    const alt = await service.pickAlternative(caseId, owner, {
      role: "alternative", route: "company_car", vehicleCode: "CAR-10",
      participation: 300, maintenanceAllowance: 0,
    });
    await service.computeAndSaveComparison(caseId, owner);
    const cur = await service.getCaseState(caseId, owner);
    const { inquiry } = await service.openInquiry(caseId, owner, "employee_participation", alt.id, {
      type: "employee_participation", route: alt.route, vehicle: alt.vehicleCode ?? "",
      group: cur!.facts.reportedGroup ?? "", factsRevision: cur!.case.factsRevision,
    });
    return { caseId, altId: alt.id, inquiryId: inquiry.id };
  }

  it("מענה מוחל ומחושב מחדש; רענון (שירות חדש) מציג תשובה ו-delta מעודכן", { timeout: 40000 }, async () => {
    const owner = "pg-rep-apply-" + randomUUID();
    const { caseId, altId, inquiryId } = await setup(owner);

    const before = await service.getCaseState(caseId, owner);
    const deltaBefore = before!.latestComparison!.result.netDeltaDisplay;

    const res = await service.answerAndApplyInquiry(inquiryId, owner, {
      value: 900, note: "נמסר ע\"י מעסיק", effectiveFrom: "2026-01-01",
    }, { today: "2026-10-18" });
    expect(res.status).toBe("applied");
    expect(res.recomputed).toBe(true);

    // שחזור: מופע שירות חדש (כמו שרת אחרי רענון) טוען מ-Postgres.
    const freshRepo = new PgCaseRepository(DATABASE_URL!);
    const freshService = new CaseService(freshRepo);
    try {
      const after = await freshService.getCaseState(caseId, owner);
      expect(after!.scenarios.find((s) => s.id === altId)!.participation).toBe(900);
      expect(after!.latestComparison!.result.netDeltaDisplay).toBeLessThan(deltaBefore);
      const answered = after!.openInquiries.find((q) => q.id === inquiryId);
      expect(answered!.status).toBe("answered");
      expect(answered!.answerValue).toBe(900);
      expect(answered!.effectiveFrom).toBe("2026-01-01");
    } finally {
      await freshRepo.close();
    }
  });

  it("בידוד בעלות (RLS): בעלים אחר לא רואה את הפנייה ולא יכול לענות", { timeout: 40000 }, async () => {
    const owner = "pg-rep-iso-" + randomUUID();
    const other = "pg-rep-other-" + randomUUID();
    owners.push(other);
    const { inquiryId } = await setup(owner);

    const otherList = await service.listInquiriesForRep(other);
    expect(otherList.find((x) => x.inquiry.id === inquiryId)).toBeFalsy();

    const res = await service.answerAndApplyInquiry(inquiryId, other, { value: 500, note: null, effectiveFrom: null });
    expect(res.status).toBe("not_found");
  });

  it("החלה-אם-רלוונטי מול Postgres: גרסת עובדות שהשתנתה -> נרשם אך לא מוחל", { timeout: 40000 }, async () => {
    const owner = "pg-rep-stale-" + randomUUID();
    const { caseId, altId, inquiryId } = await setup(owner);
    const cur = await service.getCaseState(caseId, owner);
    await service.updateFacts(caseId, owner, { baseSalary: 20000 }, cur!.case.factsRevision);

    const res = await service.answerAndApplyInquiry(inquiryId, owner, { value: 900, note: null, effectiveFrom: null });
    expect(res.status).toBe("stale_context");
    const after = await service.getCaseState(caseId, owner);
    expect(after!.scenarios.find((s) => s.id === altId)!.participation).toBe(300);
    expect(after!.openInquiries.find((q) => q.id === inquiryId)!.status).toBe("answered");
  });

  it("תחולה עתידית מול Postgres: נשמרת אך אינה מוחלת", { timeout: 40000 }, async () => {
    const owner = "pg-rep-future-" + randomUUID();
    const { caseId, altId, inquiryId } = await setup(owner);
    const res = await service.answerAndApplyInquiry(
      inquiryId, owner,
      { value: 900, note: null, effectiveFrom: "2030-01-01" },
      { today: "2026-10-18" },
    );
    expect(res.status).toBe("future_effective");
    const after = await service.getCaseState(caseId, owner);
    expect(after!.scenarios.find((s) => s.id === altId)!.participation).toBe(300);
    expect(after!.openInquiries.find((q) => q.id === inquiryId)!.effectiveFrom).toBe("2030-01-01");
  });

  it("אין החלה כפולה מול Postgres: ניסיון חוזר באותה תשובה אינו מגדיל revision", { timeout: 40000 }, async () => {
    const owner = "pg-rep-idem-" + randomUUID();
    const { caseId, altId, inquiryId } = await setup(owner);
    await service.answerAndApplyInquiry(inquiryId, owner, { value: 900, note: null, effectiveFrom: null });
    const mid = await service.getCaseState(caseId, owner);
    const rev1 = mid!.scenarios.find((s) => s.id === altId)!.revision;
    await service.answerAndApplyInquiry(inquiryId, owner, { value: 900, note: null, effectiveFrom: null });
    const end = await service.getCaseState(caseId, owner);
    const rev2 = end!.scenarios.find((s) => s.id === altId)!.revision;
    expect(rev2).toBe(rev1);
  });
});

describe("סטטוס בדיקות נציג מול Postgres", () => {
  it(DATABASE_URL ? "DATABASE_URL מוגדר - בדיקות נציג מול Postgres רצות" : "DATABASE_URL חסר - skipped", () => {
    expect(true).toBe(true);
  });
});