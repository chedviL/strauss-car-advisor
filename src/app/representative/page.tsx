// src/app/representative/page.tsx
// מסך נציג. נגיש רק למי שיש לו תפקיד נציג פעיל (staff_roles) והיקף סוגי פניות.
// ההרשאה נקבעת בשרת ונאכפת ב-SQL; עובד רגיל רואה הודעת "אין הרשאה" ולא נתונים.
// מוצג ההקשר הנחוץ להכרעה בלבד: ללא שכר, נטו, מייל או זהות בעלים.
import { DemoBadge } from "../../features/advisor/DemoBadge.js";
import { RepresentativePanel } from "../../features/advisor/RepresentativePanel.js";
import { AppHeader } from "../../features/brand/AppHeader.js";
import { loadRepInquiries } from "../actions.js";
import { redirect } from "next/navigation";
import { getSessionUser } from "../../server/auth/next-session.js";

// עמוד מאומת פר-משתמש: לעולם לא סטטי (קורא סשן/עוגיות). חובה לבנייה ב-Vercel.
export const dynamic = "force-dynamic";

export default async function RepresentativePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const res = await loadRepInquiries();

  return (
    <main className="app-main">
      {/* מסך הנציג: אותה שפה, ממשק עבודה ממוקד. ללא רקע רכב דומיננטי (app-main בלבד). */}
      <AppHeader actions={<a className="btn btn-ghost" href="/inquiries" style={{ borderRadius: "var(--radius-pill)" }}>חזרה לבירורים</a>} />
      <DemoBadge />
      <div className="app-content" style={{ paddingTop: "var(--space-3)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
          <h1 style={{ fontSize: "var(--font-xl)", margin: 0 }}>אזור נציג</h1>
        </div>
        {res.status === "forbidden" ? (
          <div role="alert" className="card" style={{ padding: "var(--space-4)" }}>
            <strong>אין לך הרשאת נציג.</strong>
            <p style={{ color: "var(--color-muted)", marginTop: "var(--space-2)" }}>
              הגישה לאזור זה ניתנת רק לנציגים מורשים. אם לדעתך מדובר בטעות, פנה/י למנהל המערכת.
            </p>
          </div>
        ) : (
          <>
            <p style={{ color: "var(--color-muted)", margin: 0, fontSize: "var(--font-sm)" }}>
              מוצגות הפניות שבהיקף ההרשאה שלך בלבד. התשובה מוחלת על התיק ומעדכנת את ההשוואה אוטומטית,
              גם אם העובד/ת אינו/ה מחובר/ת כעת. מוצג ההקשר הנחוץ להכרעה בלבד, ללא שכר או פרטים אישיים.
            </p>
            <RepresentativePanel inquiries={res.inquiries} />
          </>
        )}
      </div>
    </main>
  );
}