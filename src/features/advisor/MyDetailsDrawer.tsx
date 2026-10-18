// src/features/advisor/MyDetailsDrawer.tsx
"use client";
// מגירה נפתחת/נסגרת ל"הפרטים שלי". סגורה כברירת מחדל; השיחה והתוצאות במרכז.
// נפתחת בלחיצה, נסגרת בלחיצה/Escape/לחיצה על הרקע. בלי פאנל דביק פתוח.

import { useEffect, useState } from "react";
import { MyDetailsPanel } from "./MyDetailsPanel.js";

type Facts = React.ComponentProps<typeof MyDetailsPanel>["facts"];

export function MyDetailsDrawer({ facts }: { facts: Facts }) {
  const [open, setOpen] = useState(false); // סגורה כברירת מחדל

  // סגירה ב-Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="btn"
        aria-expanded={open}
        aria-controls="my-details-drawer"
        onClick={() => setOpen((v) => !v)}
      >
        הפרטים שלי
      </button>

      {open && (
        <>
          {/* רקע לחיצה-לסגירה */}
          <div
            onClick={() => setOpen(false)}
            aria-hidden="true"
            style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.28)", zIndex: 40 }}
          />
          {/* המגירה עצמה - נפתחת מצד ההתחלה (ימין ב-RTL) */}
          <div
            id="my-details-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="הפרטים שלי"
            style={{
              position: "fixed", insetBlock: 0, insetInlineStart: 0, zIndex: 50,
              width: "min(440px, 92vw)", background: "var(--color-bg)",
              boxShadow: "var(--shadow)", overflowY: "auto", padding: "var(--space-3)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "var(--space-2)" }}>
              <button type="button" className="btn" onClick={() => setOpen(false)} aria-label="סגירה">
                סגור
              </button>
            </div>
            <MyDetailsPanel facts={facts} />
          </div>
        </>
      )}
    </>
  );
}