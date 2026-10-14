// src/app/representative/page.tsx
// מסך נציג - שלד לחתך זה. ההרשאות והתשובות המובנות ייבנו בשלב הנציג.
import { DemoBadge } from "../../features/advisor/DemoBadge.js";

export default function RepresentativePage() {
  return (
    <main style={{ minHeight: "100vh" }}>
      <DemoBadge />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "var(--space-4)" }}>
        <a className="btn" href="/">חזרה למסך העובד</a>
        <h1 style={{ fontSize: "var(--font-xl)" }}>אזור נציג</h1>
        <p style={{ color: "var(--color-muted)" }}>
          בסביבת הדגמה, אזור הנציג יציג רק פניות של אותו ביקור. מסך הפניות
          והתשובות המובנות (עם תאריך תחולה) ייבנו בשלב הנציג. בשימוש רגיל נדרשת
          הרשאת נציג המוקצית במנגנון ניהולי מוגן.
        </p>
      </div>
    </main>
  );
}