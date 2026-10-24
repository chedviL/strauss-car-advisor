// tests/services/rep-inquiry-flow.test.ts
// חתך מסך הנציג (file repo, ללא מודל): פתיחת פנייה → מענה נציג + החלה +
// חישוב מחדש בצד השרת → העובד/ת (רענון) רואה את התשובה ואת התוצאה המעודכנת.
// בנוסף: בידוד בעלות, והחלה-אם-רלוונטי (גרסת עובדות שהשתנתה אינה מוחלת).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileCaseRepository } from "../../src/server/repositories/case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";

let dir: string;
let service: CaseService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "strauss-rep-"));
  service = new CaseService(new FileCaseRepository(dir));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function setupCaseWithAltInquiry(owner: string) {
  const state = await service.createDemoCaseFromEmployee(owner, "E-001");
  const caseId = state.case.id;
  const alt = await service.pickAlternative(caseId, owner, {
    role: "alternative", route: "company_car",
    vehicleCode: "CAR-10", participation: 300, maintenanceAllowance: 0,
  });
  await service.computeAndSaveComparison(caseId, owner);
  // פנייה לנציג על ההשתתפות של החלופה (ההקשר כולל factsRevision - לבדיקת רלוונטיות).
  const cur = await service.getCaseState(caseId, owner);
  const { inquiry } = await service.openInquiry(caseId, owner, "employee_participation", alt.id, {
    type: "employee_participation", route: alt.route, vehicle: alt.vehicleCode ?? "",
    group: cur!.facts.reportedGroup ?? "", factsRevision: cur!.case.factsRevision,
  });
  return { caseId, altId: alt.id, inquiryId: inquiry.id };
}

describe("מסך נציג: מענה → החלה → חישוב מחדש → העובד/ת רואה תוצאה מעודכנת", () => {
  it("רשימת הפניות מציגה הקשר מינימלי ללא שכר/נטו", async () => {
    const owner = "visit-rep-1";
    const { inquiryId } = await setupCaseWithAltInquiry(owner);
    const list = await service.listInquiriesForRep(owner);
    const item = list.find((x) => x.inquiry.id === inquiryId);
    expect(item).toBeTruthy();
    expect(item!.inquiry.type).toBe("employee_participation");
    expect(item!.route).toBe("company_car");
    expect(item!.reportedGroup).toBe("ג");
    // ההקשר אינו חושף שכר/נטו - אין שדות כאלה במבנה התצוגה.
    expect(Object.keys(item!)).not.toContain("baseSalary");
    expect(Object.keys(item!)).not.toContain("net");
  });

  it("מענה מוחל על החלופה ומחשב מחדש; גרסת הרענון מציגה תשובה ו-delta מעודכן", async () => {
    const owner = "visit-rep-2";
    const { caseId, altId, inquiryId } = await setupCaseWithAltInquiry(owner);
    const before = await service.getCaseState(caseId, owner);
    const deltaBefore = before!.latestComparison!.result.netDeltaDisplay;

    const res = await service.answerAndApplyInquiry(inquiryId, owner, {
      value: 900, note: "נמסר ע\"י מעסיק", effectiveFrom: "2026-01-01",
    });
    expect(res.status).toBe("applied");
    expect(res.recomputed).toBe(true);

    // שחזור (רענון): שירות טרי מאותו אחסון.
    const fresh = new CaseService(new FileCaseRepository(dir));
    const after = await fresh.getCaseState(caseId, owner);
    // ההשתתפות של החלופה עודכנה ל-900.
    const altAfter = after!.scenarios.find((s) => s.id === altId);
    expect(altAfter!.participation).toBe(900);
    // ההשוואה חושבה מחדש: השתתפות גבוהה יותר -> נטו חלופה נמוך יותר -> delta קטן יותר.
    const deltaAfter = after!.latestComparison!.result.netDeltaDisplay;
    expect(deltaAfter).toBeLessThan(deltaBefore);
    // התשובה נרשמה ונראית לעובד/ת.
    const answered = after!.openInquiries.find((q) => q.id === inquiryId);
    expect(answered!.status).toBe("answered");
    expect(answered!.answerValue).toBe(900);
    expect(answered!.effectiveFrom).toBe("2026-01-01");
  });

  it("בידוד בעלות: בעלים אחר אינו רואה ואינו יכול לענות לפנייה", async () => {
    const owner = "visit-rep-3";
    const { inquiryId } = await setupCaseWithAltInquiry(owner);
    // בעלים אחר אינו רואה את הפנייה.
    const otherList = await service.listInquiriesForRep("visit-other");
    expect(otherList.find((x) => x.inquiry.id === inquiryId)).toBeFalsy();
    // ומענה בשם בעלים אחר אינו מאתר אותה (not_found), לא מחיל כלום.
    const res = await service.answerAndApplyInquiry(inquiryId, "visit-other", {
      value: 500, note: null, effectiveFrom: null,
    });
    expect(res.status).toBe("not_found");
  });

  it("תחולה עתידית: נשמרת אך אינה מוחלת כאילו כבר בתוקף", async () => {
    const owner = "visit-rep-future";
    const { caseId, altId, inquiryId } = await setupCaseWithAltInquiry(owner);
    // תחולה עתידית ברורה (today מוזרק כדי שהבדיקה תהיה דטרמיניסטית).
    const res = await service.answerAndApplyInquiry(
      inquiryId, owner,
      { value: 900, note: null, effectiveFrom: "2030-01-01" },
      { today: "2026-10-18" },
    );
    expect(res.status).toBe("future_effective");
    expect(res.effectiveFrom).toBe("2030-01-01");
    // לא הוחל: ההשתתפות נשארה 300, אך התשובה נרשמה.
    const after = await service.getCaseState(caseId, owner);
    const altAfter = after!.scenarios.find((s) => s.id === altId);
    expect(altAfter!.participation).toBe(300);
    const answered = after!.openInquiries.find((q) => q.id === inquiryId);
    expect(answered!.status).toBe("answered");
    expect(answered!.effectiveFrom).toBe("2030-01-01");
  });

  it("תחולה היום: אינה עתידית - מוחלת מיד", async () => {
    const owner = "visit-rep-today";
    const { caseId, altId, inquiryId } = await setupCaseWithAltInquiry(owner);
    const res = await service.answerAndApplyInquiry(
      inquiryId, owner,
      { value: 900, note: null, effectiveFrom: "2026-10-18" },
      { today: "2026-10-18" },
    );
    expect(res.status).toBe("applied");
    const after = await service.getCaseState(caseId, owner);
    expect(after!.scenarios.find((s) => s.id === altId)!.participation).toBe(900);
  });

  it("אין החלה כפולה: ניסיון חוזר עם אותה תשובה אינו מגדיל revision ואינו משנה תוצאה", async () => {
    const owner = "visit-rep-idem";
    const { caseId, altId, inquiryId } = await setupCaseWithAltInquiry(owner);
    const r1 = await service.answerAndApplyInquiry(inquiryId, owner, { value: 900, note: null, effectiveFrom: null });
    expect(r1.status).toBe("applied");
    const mid = await service.getCaseState(caseId, owner);
    const revAfter1 = mid!.scenarios.find((s) => s.id === altId)!.revision;
    const deltaAfter1 = mid!.latestComparison!.result.netDeltaDisplay;

    // ניסיון חוזר (כמו התאוששות מכשל חלקי) - אותה תשובה בדיוק.
    const r2 = await service.answerAndApplyInquiry(inquiryId, owner, { value: 900, note: null, effectiveFrom: null });
    expect(r2.status).toBe("applied");
    const end = await service.getCaseState(caseId, owner);
    const revAfter2 = end!.scenarios.find((s) => s.id === altId)!.revision;
    const deltaAfter2 = end!.latestComparison!.result.netDeltaDisplay;

    // ההשתתפות כבר הייתה 900 -> לא נכתב שוב -> revision לא גדל (אין החלה כפולה).
    expect(revAfter2).toBe(revAfter1);
    expect(deltaAfter2).toBe(deltaAfter1);
  });

  it("retry זהה אינו משנה answeredAt או יוצר comparison חדש", async () => {
    const owner = "visit-rep-retry-stable";
    const { caseId, inquiryId } = await setupCaseWithAltInquiry(owner);
    const answer = { value: 600, note: "אושר", effectiveFrom: null };
    await service.answerAndApplyInquiry(inquiryId, owner, answer);
    const first = await service.getCaseState(caseId, owner);
    const answeredAt = first!.openInquiries.find((item) => item.id === inquiryId)!.answeredAt;
    const comparisonId = first!.latestComparison!.id;
    const completedAt = first!.latestComparison!.completedAt;

    const retried = await service.answerAndApplyInquiry(inquiryId, owner, answer);
    const after = await service.getCaseState(caseId, owner);

    expect(retried.recomputed).toBe(true);
    expect(after!.openInquiries.find((item) => item.id === inquiryId)!.answeredAt).toBe(answeredAt);
    expect(after!.latestComparison!.id).toBe(comparisonId);
    expect(after!.latestComparison!.completedAt).toBe(completedAt);
  });

  it("הבהרת זכאות: נרשמת כתשובה אך אינה ערך-החלה ואינה משנה תרחיש", async () => {
    const owner = "visit-rep-elig";
    const state = await service.createDemoCaseFromEmployee(owner, "E-001");
    const caseId = state.case.id;
    const alt = await service.pickAlternative(caseId, owner, {
      role: "alternative", route: "company_car", vehicleCode: "CAR-10", participation: 300, maintenanceAllowance: 0,
    });
    await service.computeAndSaveComparison(caseId, owner);
    const cur = await service.getCaseState(caseId, owner);
    const { inquiry } = await service.openInquiry(caseId, owner, "occupation_eligibility_clarification", alt.id, {
      type: "occupation_eligibility_clarification", route: alt.route, vehicle: alt.vehicleCode ?? "",
      group: cur!.facts.reportedGroup ?? "", factsRevision: cur!.case.factsRevision,
    });
    const res = await service.answerAndApplyInquiry(inquiry.id, owner, { value: null, note: "זכאי/ת לקבוצה ג", effectiveFrom: null });
    expect(res.status).toBe("recorded_not_applied");
    expect(res.reason).toBe("not_participation");
    const after = await service.getCaseState(caseId, owner);
    expect(after!.scenarios.find((s) => s.id === alt.id)!.participation).toBe(300);
    const answered = after!.openInquiries.find((q) => q.id === inquiry.id);
    expect(answered!.answerNote).toBe("זכאי/ת לקבוצה ג");
  });
  it("החלה-אם-רלוונטי: אם גרסת העובדות השתנתה מאז הפנייה - נרשם אך לא מוחל", async () => {
    const owner = "visit-rep-4";
    const { caseId, altId, inquiryId } = await setupCaseWithAltInquiry(owner);
    const cur = await service.getCaseState(caseId, owner);
    // שינוי עובדה אמיתי מעלה factsRevision -> ההקשר של הפנייה מתיישן.
    await service.updateFacts(caseId, owner, { baseSalary: 20000 }, cur!.case.factsRevision);

    const res = await service.answerAndApplyInquiry(inquiryId, owner, {
      value: 900, note: null, effectiveFrom: null,
    });
    expect(res.status).toBe("stale_context");

    // התשובה נרשמה, אך ההשתתפות של החלופה לא הוחלה אוטומטית (נשארה 300).
    const after = await service.getCaseState(caseId, owner);
    const altAfter = after!.scenarios.find((s) => s.id === altId);
    expect(altAfter!.participation).toBe(300);
    const answered = after!.openInquiries.find((q) => q.id === inquiryId);
    expect(answered!.status).toBe("answered");
    expect(answered!.answerValue).toBe(900);
  });
});