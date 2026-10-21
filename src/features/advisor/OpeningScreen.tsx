// src/features/advisor/OpeningScreen.tsx
"use client";
// מסך פתיחה: כותרת מרכזית + תיבת שיחה בולטת + שאלות לדוגמה בעדינות מתחת,
// ובחירת עובד לדוגמה (סביבת הדגמה). שאלות לדוגמה אינן שלושה כפתורים גדולים.

import { useTransition } from "react";
import { startDemoCase } from "../../app/actions.js";
import type { SampleEmployee } from "../../../data/source/sample-employees.js";

export function OpeningScreen({ employees }: { employees: SampleEmployee[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <section style={{ textAlign: "center", paddingTop: "var(--space-5)" }}>
      <h1 style={{ fontSize: "var(--font-xl)", margin: 0 }}>
        הרכב הבא שלך. מה הוא ישנה בנטו?
      </h1>
      <p style={{ color: "var(--color-muted)", marginTop: "var(--space-2)" }}>
        דבר איתי בחופשיות. אבדוק זכאות, אשלוף שווי שימוש ואחשב את ההפרש בנטו.
      </p>



      {/* שאלות לדוגמה - בעדינות, לא כפתורים גדולים */}
      <div style={{ maxWidth: 640, margin: "var(--space-2) auto 0", textAlign: "start" }}>
        <span style={{ fontSize: "0.82rem", color: "var(--color-muted)" }}>
          אפשר לשאול למשל:
        </span>
        <ul style={{ margin: "var(--space-1) 0 0", paddingInlineStart: "1.1rem", color: "var(--color-muted)", fontSize: "0.85rem" }}>
          <li>מה יקרה לנטו אם אעבור לרכב חשמלי?</li>
          <li>יש לי 5 ילדים - מה נותן המסלול המשפחתי?</li>
          <li>כמה אקבל אם אוותר על הרכב ואקבל אחזקה?</li>
        </ul>
      </div>

      <div style={{ marginTop: "var(--space-5)" }}>
        <h2 style={{ fontSize: "var(--font-lg)" }}>בחר עובד לדוגמה</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "var(--space-3)",
            marginTop: "var(--space-3)",
          }}
        >
          {employees.map((e) => (
            <button
              key={e.id}
              className="btn"
              style={{ textAlign: "start", padding: "var(--space-3)", borderRadius: "var(--radius-md)" }}
              disabled={pending}
              onClick={() => startTransition(() => startDemoCase(e.id))}
            >
              <div style={{ fontWeight: 600 }}>{e.name}</div>
              <div style={{ color: "var(--color-muted)", fontSize: "0.85rem" }}>
                {e.occupationName} · קבוצה {e.group}
              </div>
              <div style={{ marginTop: "var(--space-2)", fontSize: "0.85rem" }}>
                {e.question}
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}