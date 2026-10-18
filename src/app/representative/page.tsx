// src/app/representative/page.tsx
// מסך נציג. מציג את הפניות של אותו ביקור (owner) עם ההקשר הנחוץ בלבד, ומענה מובנה.
// המענה מוחל ומחושב בצד השרת — עובד גם כשהעובדת מנותקת. בשימוש אמיתי נדרשת
// הרשאת נציג המוקצית במנגנון ניהולי מוגן (כאן: בידוד ברמת הביקור, כמו מסך העובד).
import { DemoBadge } from "../../features/advisor/DemoBadge.js";
import { RepresentativePanel } from "../../features/advisor/RepresentativePanel.js";
import { loadRepInquiries } from "../actions.js";

export default async function RepresentativePage() {
  const inquiries = await loadRepInquiries();

  return (
    <main style={{ minHeight: "100vh" }}>
      <DemoBadge />
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
          <h1 style={{ fontSize: "var(--font-xl)", margin: 0 }}>אזור נציג</h1>
          <a className="btn btn-ghost" href="/" style={{ borderRadius: "var(--radius-pill)" }}>חזרה למסך העובד/ת</a>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", alignSelf: "flex-start",
          background: "var(--color-surface-2)", border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-pill)", padding: "2px var(--space-3)", fontSize: "0.72rem", color: "var(--color-muted)" }}>
          מסלול הדגמה מבוסס-ביקור — אינו הרשאת נציג אמיתית
        </div>
        <p style={{ color: "var(--color-muted)", margin: 0, fontSize: "var(--font-sm)" }}>
          בסביבת הדגמה מוצגות רק פניות של אותו ביקור (אותו דפדפן). התשובה שנרשמת
          מוחלת על התיק ומעדכנת את ההשוואה אוטומטית — גם אם העובד/ת אינו/ה מחובר/ת
          כעת. מוצג ההקשר הנחוץ להכרעה בלבד, ללא שכר או פרטים אישיים. בפריסת אמת
          תידרש הרשאת נציג נפרדת המוקצית במנגנון ניהולי מוגן.
        </p>
        <RepresentativePanel inquiries={inquiries} />
      </div>
    </main>
  );
}