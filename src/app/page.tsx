// src/app/page.tsx
// מסך העובד/ת. השיחה והתוצאות במרכז; "הפרטים שלי" במגירה (סגורה כברירת מחדל).
// כותרת-טקסט (wordmark) - אין לוגו מקורי בפרויקט, ולכן לא ממציאים סמל.
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
  const hasComparison = !!(state && state.latestComparison);
  const hasHistory = initialMessages.length > 0;

  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <TopBar facts={facts} />
      <DemoBadge />

      <div style={{ flex: 1, width: "100%", maxWidth: 820, margin: "0 auto", padding: "0 var(--space-4) var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {/* כותרת פתיחה - מוצגת כשאין עדיין שיחה */}
        {!hasHistory && !hasComparison && (
          <header style={{ textAlign: "center", paddingTop: "var(--space-6)" }}>
            <div style={{ color: "var(--color-muted)", fontSize: "var(--font-sm)", letterSpacing: "0.04em", marginBottom: "var(--space-2)" }}>
              שטראוס · יועץ הרכב האישי
            </div>
            <h1>הרכב הבא שלך. מה הוא ישנה בנטו?</h1>
            <p style={{ color: "var(--color-muted)", marginTop: "var(--space-3)", fontSize: "var(--font-lg)", maxWidth: 560, marginInline: "auto" }}>
              ספרו לי מה תרצו לבדוק. אבדוק זכאות, אשלוף את שווי השימוש ואחשב את ההפרש בנטו.
            </p>
          </header>
        )}

        {hasComparison && (
          <div className="anim-card">
            <ComparisonView state={state!} employee={null} />
          </div>
        )}

        <ChatPanel initialMessages={initialMessages} showExamples={!hasHistory && !hasComparison} />
      </div>
    </main>
  );
}

function TopBar({ facts }: { facts: CaseFacts }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-3) var(--space-4)", maxWidth: 1100, margin: "0 auto", width: "100%" }}>
      <div style={{ fontWeight: 800, fontSize: "var(--font-lg)", letterSpacing: "-0.01em" }}>
        שטראוס<span style={{ color: "var(--color-primary)" }}> · יועץ הרכב</span>
      </div>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
        <MyDetailsDrawer facts={facts} />
        <NewConversationButton />
        <a className="btn-ghost btn" href="/representative" aria-label="אזור נציג" style={{ borderRadius: "var(--radius-pill)" }}>אזור נציג</a>
      </div>
    </div>
  );
}