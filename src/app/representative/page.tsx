// src/app/representative/page.tsx
// מסך נציג מלא אחד, על אותם שירותים, בשני מצבי גישה:
//   staff - נציג מורשה (תפקיד פעיל + היקף ב-staff_roles, ערוץ ניהולי בלבד);
//   demo  - התנסות מוגבלת לפניות בדיקה, רק כשדגל השרת REP_DEMO_ACCESS_ENABLED מופעל.
// ההרשאה נקבעת בשרת ונאכפת ב-SQL. משתמש ללא גישה רואה הסבר (ואם ההתנסות פעילה - כפתור
// התנסות). מוצג ההקשר הנחוץ להכרעה בלבד: ללא שכר, נטו, תלוש או זהות בעלים.
import { redirect } from "next/navigation";
import { DemoBadge } from "../../features/advisor/DemoBadge.js";
import { AppHeader } from "../../features/brand/AppHeader.js";
import { AccountMenu } from "../../features/auth/AccountMenu.js";
import { RepresentativeWorkspace } from "../../features/representative/RepresentativeWorkspace.js";
import { DemoIntro } from "../../features/representative/DemoIntro.js";
import { DEMO_NOTICE } from "../../features/representative/rep-format.js";
import "../../features/representative/representative.css";
import { loadRepWorkspace } from "../actions.js";
import { getSessionUser } from "../../server/auth/next-session.js";

// עמוד מאומת פר-משתמש: לעולם לא סטטי. maxDuration: הכנת פניות הדוגמה בלחיצה הראשונה
// כוללת כמה חישובי השוואה מול המסד.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function RepresentativePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const ws = await loadRepWorkspace();
  if (ws.status === "unauthenticated") redirect("/login");

  return (
    <main id="main-content" className="app-main">
      <AppHeader center={<AccountMenu email={user.email} area="rep" />} />
      <DemoBadge />
      <div className="rep-shell">
        <div className="rep-titlebar">
          <h1>אזור נציג</h1>
          {ws.status === "ok" && (
            <span className="rep-mode" data-mode={ws.mode}>
              {ws.mode === "demo" ? "התנסות — הדגמה" : "גישה רגילה — נציג מורשה"}
            </span>
          )}
        </div>

        {ws.status === "none" && (
          <>
            <div role="note" className="rep-card">
              <h2>אין לך הרשאת נציג</h2>
              <p>
                אזור זה מיועד לנציגים מורשים. הרשאת נציג ניתנת בערוץ ניהולי מוגן בלבד, ואינה ניתנת לבחירה
                עצמית. אם לדעתך מדובר בטעות, פנה/י למנהל המערכת.
              </p>
            </div>
            {ws.demoAvailable ? (
              <DemoIntro />
            ) : (
              <p className="rep-hint">ההתנסות בתפקיד נציג אינה פעילה כרגע.</p>
            )}
          </>
        )}

        {ws.status === "ok" && (
          <>
            {ws.mode === "demo" ? (
              <p className="rep-notice" role="note">{DEMO_NOTICE}</p>
            ) : (
              <p className="rep-hint">
                מוצגות הפניות שבהיקף ההרשאה שלך בלבד. התשובה מוחלת על התיק ומעדכנת את ההשוואה אוטומטית, גם אם
                העובד/ת אינו/ה מחובר/ת כעת. מוצג ההקשר הנחוץ להכרעה בלבד, ללא שכר או פרטים אישיים.
              </p>
            )}
            <RepresentativeWorkspace
              mode={ws.mode}
              initialInquiries={ws.inquiries}
              vehicleNames={ws.vehicleNames}
            />
          </>
        )}
      </div>
    </main>
  );
}
