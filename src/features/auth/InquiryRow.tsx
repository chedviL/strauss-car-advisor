// src/features/auth/InquiryRow.tsx
// שורת בירור ברשימה: כותרת (מההודעה הראשונה), מצב, זמן עדכון, ו"המשך".
import { continueInquiry } from "../../app/inquiry-actions.js";

type Summary = {
  caseId: string; title: string | null; messageCount: number;
  hasComparison: boolean; hasOpenInquiry: boolean; updatedAt: string;
};

function fmt(iso: string): string {
  try {
    return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(new Date(iso));
  } catch { return iso.slice(0, 16).replace("T", " "); }
}

export function InquiryRow({ summary }: { summary: Summary }) {
  const tags: string[] = [];
  if (summary.hasComparison) tags.push("יש השוואה");
  if (summary.hasOpenInquiry) tags.push("ממתין לנציג");
  return (
    <form action={continueInquiry}>
      <input type="hidden" name="caseId" value={summary.caseId} />
      <button
        type="submit"
        className="card"
        style={{
          width: "100%", textAlign: "start", cursor: "pointer", font: "inherit", color: "inherit",
          padding: "var(--space-3) var(--space-4)", display: "flex", flexDirection: "column", gap: 4,
        }}
        aria-label={`המשך בירור: ${summary.title ?? "שיחה ללא הודעות"}`}
      >
        <span style={{ fontWeight: 600 }}>{summary.title ?? "שיחה חדשה (עדיין ללא הודעות)"}</span>
        <span style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", color: "var(--color-muted)", fontSize: "var(--font-sm)" }}>
          <span>עודכן {fmt(summary.updatedAt)}</span>
          <span>{summary.messageCount} הודעות</span>
          {tags.map((t) => (<span key={t}>· {t}</span>))}
        </span>
      </button>
    </form>
  );
}