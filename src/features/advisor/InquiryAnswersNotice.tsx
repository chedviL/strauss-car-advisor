// src/features/advisor/InquiryAnswersNotice.tsx
// חיווי שקט לעובד/ת: הנציג השיב לפנייה שנפתחה. התוצאה כבר עודכנה (חישוב מחדש
// בצד השרת); כאן רק מודיעים שהתקבלה תשובה, בעדינות. אין טקסט טכני.
import type { InquiryRecord } from "../../domain/contracts/case.js";

const TYPE_LABEL: Record<InquiryRecord["type"], string> = {
  employee_participation: "השתתפות ברכב",
  occupation_eligibility_clarification: "זכאות לפי עיסוק",
};

export function InquiryAnswersNotice({ inquiries }: { inquiries: InquiryRecord[] }) {
  const answered = inquiries.filter((q) => q.status === "answered");
  if (answered.length === 0) return null;

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
        התוצאה המעודכנת מוצגת בכרטיס ההשוואה.
      </span>
    </div>
  );
}