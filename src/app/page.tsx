// src/app/page.tsx
// מסך העובד/ת: השיחה והתוצאות במרכז. היסטוריית השיחות במגירה שנפתחת מכפתור
// בכותרת (נסתרת כברירת מחדל). לוגו שטראוס המקורי בראש.
import { getSessionUser } from "../server/auth/next-session.js";
import { redirect } from "next/navigation";
import { AccountMenu } from "../features/auth/AccountMenu.js";
import { caseService } from "../server/web/service.js";
import { ComparisonView } from "../features/advisor/ComparisonView.js";
import { DemoBadge } from "../features/advisor/DemoBadge.js";
import { ChatPanel } from "../features/advisor/ChatPanel.js";
import { InquiryAnswersNotice } from "../features/advisor/InquiryAnswersNotice.js";
import { ConversationSidebar } from "../features/advisor/ConversationSidebar.js";
import { AppHeader } from "../features/brand/AppHeader.js";
import { LightTrail } from "../features/brand/LightTrail.js";
import { ChatWave } from "../features/brand/ChatWave.js";
import type { CaseState } from "../domain/contracts/case.js";
import { isUuid } from "../domain/ids.js";

// עמוד מאומת פר-משתמש: לעולם לא סטטי (קורא סשן/עוגיות). חובה לבנייה ב-Vercel.
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  // הבעלות = המשתמש המאומת. הרשאה נקבעת בשרת; עוגיית strauss_case היא מצביע בלבד.
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const owner = user.id;
  // הבירור הפעיל נקבע ע"י מזהה מפורש ב-URL (?c=<caseId>) בלבד - לא ע"י עוגייה.
  // כניסה רגילה ל-/ (בלי הפרמטר) פותחת מסך שיחה נקי, בלי לשחזר שיחה קודמת ובלי
  // למחוק אותה. רענון בתוך שיחה פעילה שומר את ?c= ולכן משחזר אותה.
  const sp = await searchParams;
  const rawC = (sp?.c ?? "").trim();
  const caseId = isUuid(rawC) ? rawC : null;

  let state: CaseState | null = null;
  let initialMessages: Array<{ id: string; role: string; parts: unknown }> = [];
  if (owner && caseId) {
    state = await caseService().getCaseState(caseId, owner);
    if (state) {
      const stored = await caseService().loadMessages(caseId, owner);
      initialMessages = stored.map((m) => ({ id: m.clientMessageId ?? m.id, role: m.role, parts: m.content }));
    }
  }
  const hasComparison = !!(state && state.latestComparison);
  const vehicleNames = hasComparison ? await caseService().vehicleNames() : {};
  const hasHistory = initialMessages.length > 0;

  // רשימת הבירורים לסרגל הצד (היסטוריה). קריאה בלבד, לא יוצרת תיק.
  const summaries = await caseService().listCaseSummaries(owner, 50);

  const isOpening = !hasHistory && !hasComparison;

  return (
    <main id="main-content" className={`app-main ${isOpening ? "app-main-opening" : ""}`.trim()}>
      {/* רצועת הגלים הדקורטיבית - גולשת מהקיר השמאלי-תחתון, מאחורי התוכן. */}
      <ChatWave />
      <AppHeader
        leading={<ConversationSidebar summaries={summaries} activeCaseId={caseId} />}
        center={<AccountMenu email={user.email} />}
        actions={
          /* "איזה רכב מתאים לי?": הכפתור מוצג כאן (למעלה בשמאל, תמיד) ע"י ChatPanel דרך portal. */
          <span id="vm-launcher-slot" className="vm-launcher-slot" />
        }
      />
      <DemoBadge />

      {/* גוף: אזור השיחה (ההיסטוריה במגירה מהכותרת). */}
      <div className="app-body">
        <div className="app-content">
          {/* כותרת פתיחה - מוצגת כשאין עדיין שיחה */}
          {!hasHistory && !hasComparison && (
            <header className="convo-hero">
              <LightTrail mode="idle" variant="band" />
              <h1>הרכב הבא שלך — מה הוא ישנה בנטו?</h1>
              <p>אפשר לשאול, להשוות או להעלות תלוש — נתקדם יחד.</p>
            </header>
          )}

          {state && state.openInquiries.some((q) => q.status === "answered") && (
            <InquiryAnswersNotice inquiries={state.openInquiries} />
          )}

          {/* כרטיס ההשוואה מוצג בתוך זרימת השיחה, מתחת לתשובת המודל (ראו ChatPanel). */}
          {/* key לפי הבירור: useChat מכבד את initialMessages רק ביצירה. בלי key,
              מעבר בין שיחות (ניווט צד-לקוח) שומר את מצב השיחה הישן ומציג רק את
              כרטיס ההשוואה שמרונדר בשרת, בלי ההודעות. */}
          <ChatPanel
            key={`${owner}:${caseId ?? "new"}`}
            userId={owner}
            caseId={state ? caseId : null}
            initialMessages={initialMessages}
            showExamples={!hasHistory && !hasComparison}
            comparison={hasComparison ? <ComparisonView state={state!} employee={null} vehicleNames={vehicleNames} /> : null}
          />
        </div>
      </div>
    </main>
  );
}