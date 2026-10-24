import { describe, expect, it } from "vitest";
import type { CaseState, InquiryRecord } from "../../src/domain/contracts/case.js";
import type { StoredMessage } from "../../src/server/repositories/case-repository.js";
import { buildRepAnswerTimeline } from "../../src/features/advisor/rep-answer-timeline.js";

function makeInquiry(overrides: Partial<InquiryRecord> = {}): InquiryRecord {
  return {
    id: "inq-1",
    caseId: "case-1",
    type: "employee_participation",
    scenarioId: "alt-1",
    contextFingerprint: "factsRevision=1",
    status: "answered",
    createdAt: "2026-10-20T10:00:00.000Z",
    answerValue: 600,
    answerNote: "אושר על ידי הנציג",
    effectiveFrom: null,
    answeredAt: "2026-10-21T10:00:00.000Z",
    ...overrides,
  };
}

function makeState(inquiry: InquiryRecord, comparisonOverrides: Record<string, unknown> = {}): CaseState {
  return {
    case: { id: "case-1", ownerId: "owner-1", isDemo: false, datasetId: "data-1", status: "active", factsRevision: 2, pendingRequest: null, createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-21T10:00:00.000Z" },
    facts: { occupationCode: null, reportedGroup: "ג", baseSalary: 20000, commission: 0, bonus: 0, pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.25, qualifyingChildren: 0 },
    scenarios: [
      { id: "base-1", caseId: "case-1", role: "baseline", route: "company_car", vehicleCode: "BASE", participation: 300, maintenanceAllowance: 0, overrides: {}, revision: 1 },
      { id: "alt-1", caseId: "case-1", role: "alternative", route: "company_car", vehicleCode: "ALT", participation: 600, maintenanceAllowance: 0, overrides: {}, revision: 2 },
    ],
    latestComparison: {
      id: "cmp-1", caseId: "case-1", baselineScenarioId: "base-1", alternativeScenarioId: "alt-1", ruleSetHash: "hash", factsRevision: 2,
      inputSnapshot: {
        baseline: { id: "base-1", revision: 1 },
        alternative: { id: "alt-1", revision: 2, participation: 600 },
      },
      result: {
        baseline: { netDisplay: "15000", netExact: "15000", breakdown: {}, incomplete: false, missingFields: [], assumptions: [] },
        alternative: { netDisplay: "14500", netExact: "14500", breakdown: {}, incomplete: false, missingFields: [], assumptions: [] },
        netDeltaDisplay: -500,
      },
      completedAt: "2026-10-21T10:01:00.000Z",
      ...comparisonOverrides,
    } as unknown as NonNullable<CaseState["latestComparison"]>,
    openInquiries: [inquiry],
    payslipStatus: "none",
  };
}

const priorMessage: StoredMessage = {
  id: "msg-old", role: "assistant", seq: 0, clientMessageId: "msg-old", content: [{ type: "text", text: "התחלנו בבדיקה." }], createdAt: "2026-10-20T09:00:00.000Z",
};

describe("ציר זמן תשובת נציג", () => {
  it("ממזג תשובה וסיכום אחריה, לפי ה-comparison השמור", () => {
    const inquiry = makeInquiry();
    const timeline = buildRepAnswerTimeline([priorMessage], makeState(inquiry));
    expect(timeline.messages.map((message) => message.id)).toEqual([
      "msg-old", "rep-answer-inq-1", "rep-summary-inq-1-cmp-1",
    ]);
    expect(timeline.latestAnswerMessageId).toBe("rep-answer-inq-1");
    expect(timeline.messages[1]?.parts[0]?.text).toContain("600 ₪");
    expect(timeline.messages[2]?.parts[0]?.text).toContain("15,000 ₪");
    expect(timeline.messages[2]?.parts[0]?.text).toContain("14,500 ₪");
    expect(timeline.messages[2]?.parts[0]?.text).toContain("-500 ₪");
  });

  it("חזרה/רענון מייצרים אותם IDs ולא מוסיפים הודעות למסד", () => {
    const inquiry = makeInquiry();
    const state = makeState(inquiry);
    const first = buildRepAnswerTimeline([priorMessage], state);
    const refreshed = buildRepAnswerTimeline([priorMessage], state);
    expect(refreshed.messages.map((message) => message.id)).toEqual(first.messages.map((message) => message.id));
    expect(new Set(refreshed.messages.map((message) => message.id)).size).toBe(refreshed.messages.length);
  });

  it("לא מציג סיכום אם ההשוואה קדמה לתשובה, stale או אינה כוללת את הערך שאושר", () => {
    const inquiry = makeInquiry();
    const early = buildRepAnswerTimeline([priorMessage], makeState(inquiry, { completedAt: "2026-10-21T09:59:00.000Z" }));
    expect(early.messages.at(-1)?.id).toBe("rep-answer-status-inq-1");
    expect(early.messages.at(-1)?.parts[0]?.text).not.toContain("14,500 ₪");

    const staleState = makeState(inquiry);
    staleState.case.factsRevision += 1;
    const stale = buildRepAnswerTimeline([priorMessage], staleState);
    expect(stale.messages.at(-1)?.id).toBe("rep-answer-status-inq-1");

    const mismatched = makeState(inquiry);
    mismatched.latestComparison!.inputSnapshot.alternative = { id: "alt-1", revision: 2, participation: 300 };
    const mismatchTimeline = buildRepAnswerTimeline([priorMessage], mismatched);
    expect(mismatchTimeline.messages.at(-1)?.id).toBe("rep-answer-status-inq-1");
  });

  it("לא מציג מספרי סיכום אם comparison השמור מכיל שדות חסרים", () => {
    const inquiry = makeInquiry();
    const state = makeState(inquiry);
    state.latestComparison!.result.alternative.incomplete = true;
    state.latestComparison!.result.alternative.missingFields = ["creditPoints"];
    const timeline = buildRepAnswerTimeline([priorMessage], state);
    expect(timeline.messages.at(-1)?.id).toBe("rep-answer-status-inq-1");
    expect(timeline.messages.at(-1)?.parts[0]?.text).not.toContain("14,500 ₪");
  });

  it("תשובות קודמות נשארות, אך רק התשובה האחרונה מקבלת סיכום של ההשוואה האחרונה", () => {
    const first = makeInquiry({ id: "inq-old", answeredAt: "2026-10-20T10:00:00.000Z", answerValue: 450 });
    const latest = makeInquiry({ id: "inq-new", answeredAt: "2026-10-21T10:00:00.000Z", answerValue: 600 });
    const state = makeState(latest);
    state.openInquiries.push(first);
    const timeline = buildRepAnswerTimeline([priorMessage], state);
    expect(timeline.messages.map((message) => message.id)).toEqual([
      "msg-old", "rep-answer-inq-old", "rep-answer-inq-new", "rep-summary-inq-new-cmp-1",
    ]);
  });

  it("marker הקישור מצביע רק לתשובת הנציג האחרונה שהורכבה", () => {
    const inquiry = makeInquiry({ id: "inquiry-42" });
    const timeline = buildRepAnswerTimeline([], makeState(inquiry));
    expect(timeline.latestAnswerMessageId).toBe("rep-answer-inquiry-42");
    expect(timeline.messages.some((message) => message.id === timeline.latestAnswerMessageId)).toBe(true);
  });
});