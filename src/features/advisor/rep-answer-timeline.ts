import { isComparisonStale } from "../../domain/calculation/staleness.js";
import type { CaseState, InquiryRecord } from "../../domain/contracts/case.js";
import type { StoredMessage } from "../../server/repositories/case-repository.js";

export interface TimelineMessage {
  id: string;
  role: string;
  parts: Array<{ type: "text"; text: string }>;
}

interface TimelineEntry {
  at: number;
  order: number;
  message: TimelineMessage;
}

const INQUIRY_LABEL: Record<InquiryRecord["type"], string> = {
  employee_participation: "השתתפות ברכב",
  occupation_eligibility_clarification: "זכאות לפי עיסוק",
};

function textMessage(id: string, text: string): TimelineMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

function amount(value: string | number, signed = false): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  const sign = parsed < 0 ? "-" : signed && parsed > 0 ? "+" : "";
  const formatted = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 }).format(Math.abs(parsed));
  return `${sign}${formatted} ₪`;
}

function comparisonMatchesAnswer(state: CaseState, inquiry: InquiryRecord): boolean {
  const comparison = state.latestComparison;
  if (!comparison || inquiry.type !== "employee_participation" || inquiry.answerValue === null) return false;
  if (!inquiry.answeredAt || Date.parse(comparison.completedAt) < Date.parse(inquiry.answeredAt)) return false;
  if (isComparisonStale(state)) return false;
  if (comparison.result.baseline.incomplete || comparison.result.baseline.missingFields.length > 0) return false;
  if (comparison.result.alternative.incomplete || comparison.result.alternative.missingFields.length > 0) return false;

  const snapshot = comparison.inputSnapshot as { baseline?: { id?: unknown; participation?: unknown }; alternative?: { id?: unknown; participation?: unknown } };
  const scenario = [snapshot.baseline, snapshot.alternative].find((entry) => entry?.id === inquiry.scenarioId);
  const currentScenario = state.scenarios.find((entry) => entry.id === inquiry.scenarioId);
  return scenario?.participation === inquiry.answerValue && currentScenario?.participation === inquiry.answerValue;
}

function comparisonSummary(state: CaseState, inquiry: InquiryRecord): string {
  const comparison = state.latestComparison!;
  const base = comparison.result.baseline.netDisplay;
  const alternative = comparison.result.alternative.netDisplay;
  const delta = comparison.result.netDeltaDisplay;
  return `הנציג אישר ${INQUIRY_LABEL[inquiry.type]} של ${amount(inquiry.answerValue!)}. לפי ההשוואה המעודכנת: הנטו במצב הנוכחי ${amount(base)}, הנטו בחלופה ${amount(alternative)}, וההפרש בין החלופה למצב הנוכחי ${amount(delta, true)}.`;
}

function noComparisonExplanation(inquiry: InquiryRecord): string {
  if (inquiry.effectiveFrom && Date.parse(inquiry.effectiveFrom) > Date.now()) {
    return `הנציג השיב לגבי ${INQUIRY_LABEL[inquiry.type]}. התשובה בתוקף מ-${inquiry.effectiveFrom}, ולכן עדיין לא הוחלה על ההשוואה.`;
  }
  return `התשובה של הנציג לגבי ${INQUIRY_LABEL[inquiry.type]} נשמרה. לא נמצאה השוואה שמורה ועדכנית שמאשרת חישוב בעקבותיה, ולכן הכרטיס הקיים אינו מוצג כתוצאה מעודכנת. אפשר להמשיך בשיחה כדי לבדוק נתונים חסרים ולחשב מחדש.`;
}

export function buildRepAnswerTimeline(
  storedMessages: StoredMessage[],
  state: CaseState,
): { messages: TimelineMessage[]; latestAnswerMessageId: string | null; answerMessageIds: Record<string, string> } {
  const answered = state.openInquiries
    .filter((inquiry) => inquiry.status === "answered" && inquiry.answeredAt)
    .sort((a, b) => (a.answeredAt ?? "").localeCompare(b.answeredAt ?? ""));
  const latestInquiry = answered.at(-1) ?? null;
  const hasMatchingSummary = !!latestInquiry && comparisonMatchesAnswer(state, latestInquiry);
  const entries: TimelineEntry[] = storedMessages.map((message) => ({
    at: Date.parse(message.createdAt) || 0,
    order: 0,
    message: { id: message.clientMessageId ?? message.id, role: message.role, parts: message.content as Array<{ type: "text"; text: string }> },
  }));

  for (const inquiry of answered) {
    const answeredAt = Date.parse(inquiry.answeredAt!);
    const answerId = `rep-answer-${inquiry.id}`;
    const answerText = `התקבלה תשובת נציג — ${INQUIRY_LABEL[inquiry.type]}${inquiry.answerValue !== null ? `: ${amount(inquiry.answerValue)}` : ""}${inquiry.answerNote ? `. ${inquiry.answerNote}` : ""}${inquiry.effectiveFrom ? `. בתוקף מ-${inquiry.effectiveFrom}` : ""}.`;
    entries.push({ at: answeredAt, order: 1, message: textMessage(answerId, answerText) });

    if (inquiry.id === latestInquiry?.id && hasMatchingSummary) {
      entries.push({
        at: Date.parse(state.latestComparison!.completedAt),
        order: 2,
        message: textMessage(`rep-summary-${inquiry.id}-${state.latestComparison!.id}`, comparisonSummary(state, inquiry)),
      });
    } else if (inquiry.id === latestInquiry?.id) {
      entries.push({ at: answeredAt, order: 2, message: textMessage(`rep-answer-status-${inquiry.id}`, noComparisonExplanation(inquiry)) });
    }
  }

  entries.sort((a, b) => a.at - b.at || a.order - b.order || a.message.id.localeCompare(b.message.id));
  return {
    messages: entries.map((entry) => entry.message),
    latestAnswerMessageId: answered.at(-1) ? `rep-answer-${answered.at(-1)!.id}` : null,
    answerMessageIds: Object.fromEntries(answered.map((inquiry) => [inquiry.id, `rep-answer-${inquiry.id}`])),
  };
}