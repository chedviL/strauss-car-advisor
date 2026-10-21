// src/app/inquiries/page.tsx
// "הבירורים שלי": רשימת השיחות של המשתמש/ת המאומת/ת, המשך שיחה קודמת ושיחה חדשה.
// הרשימה נשלפת לפי הבעלות המאומתת בשרת (RLS), ולכן אינה מכילה בירורים של אחרים.
import { redirect } from "next/navigation";
import { getSessionUser } from "../../server/auth/next-session.js";
import { caseService } from "../../server/web/service.js";
import { DemoBadge } from "../../features/advisor/DemoBadge.js";
import { AccountMenu } from "../../features/auth/AccountMenu.js";
import { InquiryRow } from "../../features/auth/InquiryRow.js";
import { AppHeader } from "../../features/brand/AppHeader.js";
import { startNewInquiry } from "../inquiry-actions.js";
import { myStaffScope } from "../actions.js";

export const dynamic = "force-dynamic";

export default async function InquiriesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const [list, staff] = await Promise.all([
    caseService().listCaseSummaries(user.id, 50),
    myStaffScope(),
  ]);

  return (
    <main className="app-main">
      <AppHeader actions={<AccountMenu email={user.email} isStaff={staff.isStaff} />} />
      <DemoBadge />
      <div className="app-content" style={{ paddingTop: "var(--space-3)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "var(--font-xl)", margin: 0 }}>הבירורים שלי</h1>
          <form action={startNewInquiry}>
            <button type="submit" className="btn btn-primary">שיחה חדשה</button>
          </form>
        </div>

        {list.length === 0 ? (
          <p style={{ color: "var(--color-muted)" }}>עדיין אין בירורים. אפשר להתחיל בשיחה חדשה.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {list.map((c) => (
              <li key={c.caseId}><InquiryRow summary={c} /></li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}