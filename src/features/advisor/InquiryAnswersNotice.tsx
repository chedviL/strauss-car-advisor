// src/features/advisor/InquiryAnswersNotice.tsx
// חיווי לעובד/ת: הנציג השיב לפנייה. מציג את תשובת הנציג בנפרד מהכרטיס.
// "ההשוואה עודכנה" מוצג רק כשיש השוואה עדכנית (לא stale) — לא כשהחישוב נכשל.
import type { InquiryRecord } from "../../domain/contracts/case.js";
import type { CaseState } from "../../domain/contracts/case.js";
import { isComparisonStale } from "../../domain/calculation/staleness.js";

const TYPE_LABEL: Record<InquiryRecord["type"], string> = {
  employee_participation: "השתתפות ברכב",
  occupation_eligibility_clarification: "זכאות לפי עיסוק",
};

export function InquiryAnswersNotice({ inquiries, state }: { inquiries: InquiryRecord[]; state?: Pick<CaseState, "case" | "scenarios" | "latestComparison"> }) {
  const answered = inquiries.filter((q) => q.status === "answered");
  if (answered.length === 0) return null;

  // "ההשוואה עודכנה" רק כשיש השוואה עדכנית בפועל (לא stale, לא null).
  const hasUpdatedComparison = state && state.latestComparison && !isComparisonStale(state);

  return (
    <div
      role="status"
      style={{
        border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
        background: "var(--color-surface-2)", padding: "var(--space-3)",
        display: "flex", flexDirection: "column", gap: "var(--space-1)",
      }}
    >
      <strong style={{ fontSize: "var(--font-sm)" }}>התקבלה תשובה מהנציג</strong>
      {answered.map((q) => (
        <span key={q.id} style={{ fontSize: "var(--font-sm)", color: "var(--color-muted)" }}>
          {TYPE_LABEL[q.type]}
          {q.answerValue !== null ? `: ${q.answerValue} ₪` : ""}
          {q.answerNote ? ` — ${q.answerNote}` : ""}
          {q.effectiveFrom ? ` (בתוקף מ-${q.effectiveFrom})` : ""}
        </span>
      ))}
      <span style={{ fontSize: "0.72rem", color: "var(--color-muted)" }}>
        {hasUpdatedComparison
          ? "ההשוואה עודכנה עם הנתון שהתקבל — ראה/י את הכרטיס למטה."
          : "התשובה נרשמה. כדי לראות את ההשוואה המעודכנת, המשך/י את השיחה."}
      </span>
    </div>
  );
}