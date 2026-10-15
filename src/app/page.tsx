// src/app/page.tsx
// מסך העובד - סביבת הדגמה המבודדת. Server Component: טוען מצב ומרנדר.
import { readVisitOwner } from "../server/web/visit.js";
import { caseService } from "../server/web/service.js";
import { cookies } from "next/headers";
import { ComparisonView } from "../features/advisor/ComparisonView.js";
import { OpeningScreen } from "../features/advisor/OpeningScreen.js";
import { DemoBadge } from "../features/advisor/DemoBadge.js";
import { ChatPanel } from "../features/advisor/ChatPanel.js";
import type { CaseState } from "../domain/contracts/case.js";
import type { SampleEmployee } from "../../data/source/sample-employees.js";

export default async function Page() {
  const owner = await readVisitOwner();
  const caseId = (await cookies()).get("strauss_case")?.value ?? null;

  let state: CaseState | null = null;
  let employee: SampleEmployee | null = null;
  let initialMessages: Array<{ id: string; role: string; parts: unknown }> = [];
  if (owner && caseId) {
    state = await caseService().getCaseState(caseId, owner);
    if (state) {
      // טוענים היסטוריית שיחה לשחזור אחרי רענון.
      const stored = await caseService().loadMessages(caseId, owner);
      initialMessages = stored.map((m) => ({ id: m.clientMessageId ?? m.id, role: m.role, parts: m.content }));
      // זיהוי העובד לדוגמה לפי העובדות (לתצוגת ההקשר).
      employee =
        caseService()
          .listSampleEmployees()
          .find((e) => e.facts.baseSalary === state!.facts.baseSalary &&
            e.facts.occupationCode === state!.facts.occupationCode) ?? null;
    }
  }

  return (
    <main style={{ minHeight: "100vh", position: "relative" }}>
      <TopBar />
      <DemoBadge />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "var(--space-4)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr", gap: "var(--space-4)", alignItems: "start" }}>
          {/* צד שמאל: תוכן (כרטיס השוואה כשמוכן, אחרת מסך פתיחה) */}
          <div>
            {state && state.latestComparison ? (
              <ComparisonView state={state} employee={employee} />
            ) : (
              <OpeningScreen employees={caseService().listSampleEmployees()} />
            )}
          </div>
          {/* צד ימין: השיחה - מופע יציב שאינו מתחלף במעבר (שומר על ההיסטוריה) */}
          <div style={{ position: "sticky", top: "var(--space-3)" }}>
            <div style={{ fontSize: "0.8rem", color: "var(--color-muted)", marginBottom: "var(--space-2)" }}>
              דברו איתי כאן. אבדוק זכאות, אשלוף שווי שימוש ואחשב את הנטו.
            </div>
            <ChatPanel initialMessages={initialMessages} />
          </div>
        </div>
      </div>
    </main>
  );
}

function TopBar() {
  // כפתור "אזור נציג" בפינה השמאלית העליונה (RTL: שמאל = צד "סוף").
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-start",
        padding: "var(--space-2) var(--space-3)",
      }}
    >
      <a className="btn" href="/representative" aria-label="אזור נציג">
        אזור נציג
      </a>
    </div>
  );
}