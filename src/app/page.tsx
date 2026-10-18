// src/app/page.tsx
// מסך העובד/ת. השיחה והתוצאות במרכז; "הפרטים שלי" במגירה נפתחת (סגורה כברירת מחדל).
// כרטיס השוואה מוצג כשנשמרה תוצאה. ששת העובדים נשארים כנתוני בדיקה בקוד.
import { readVisitOwner } from "../server/web/visit.js";
import { caseService } from "../server/web/service.js";
import { cookies } from "next/headers";
import { ComparisonView } from "../features/advisor/ComparisonView.js";
import { DemoBadge } from "../features/advisor/DemoBadge.js";
import { ChatPanel } from "../features/advisor/ChatPanel.js";
import { MyDetailsDrawer } from "../features/advisor/MyDetailsDrawer.js";
import { NewConversationButton } from "../features/advisor/NewConversationButton.js";
import type { CaseState, CaseFacts } from "../domain/contracts/case.js";

const BLANK_FACTS: CaseFacts = {
  occupationCode: null, reportedGroup: null, baseSalary: null, commission: null,
  bonus: null, pensionRate: null, trainingRate: null, creditPoints: null, qualifyingChildren: null,
};

export default async function Page() {
  const owner = await readVisitOwner();
  const caseId = (await cookies()).get("strauss_case")?.value ?? null;

  let state: CaseState | null = null;
  let initialMessages: Array<{ id: string; role: string; parts: unknown }> = [];
  if (owner && caseId) {
    state = await caseService().getCaseState(caseId, owner);
    if (state) {
      const stored = await caseService().loadMessages(caseId, owner);
      initialMessages = stored.map((m) => ({ id: m.clientMessageId ?? m.id, role: m.role, parts: m.content }));
    }
  }
  const facts = state?.facts ?? BLANK_FACTS;

  return (
    <main style={{ minHeight: "100vh", position: "relative" }}>
      <TopBar facts={facts} />
      <DemoBadge />
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "var(--space-4)" }}>
        <header style={{ textAlign: "center", marginBottom: "var(--space-4)" }}>
          <h1 style={{ fontSize: "var(--font-xl)", margin: 0 }}>הרכב הבא שלך. מה הוא ישנה בנטו?</h1>
          <p style={{ color: "var(--color-muted)", marginTop: "var(--space-1)", fontSize: "0.9rem" }}>
            דברו איתי בחופשיות, או מלאו את הפרטים בעצמכם. אבדוק זכאות, אשלוף שווי שימוש ואחשב את ההפרש בנטו.
          </p>
        </header>

        {/* השיחה והתוצאות במרכז המסך. "הפרטים שלי" במגירה (נפתחת מהסרגל העליון). */}
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {state && state.latestComparison ? (
            <ComparisonView state={state} employee={null} />
          ) : null}
          <ChatPanel initialMessages={initialMessages} />
        </div>
      </div>
    </main>
  );
}

function TopBar({ facts }: { facts: CaseFacts }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start", padding: "var(--space-2) var(--space-3)" }}>
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <MyDetailsDrawer facts={facts} />
        <NewConversationButton />
        <a className="btn" href="/representative" aria-label="אזור נציג">אזור נציג</a>
      </div>
    </div>
  );
}