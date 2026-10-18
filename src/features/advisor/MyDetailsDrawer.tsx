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
            className="drawer-backdrop"
            onClick={() => setOpen(false)}
            aria-hidden="true"
            style={{ position: "fixed", inset: 0, background: "rgba(34,29,24,0.32)", zIndex: 40 }}
          />
          {/* המגירה עצמה - נפתחת מצד ההתחלה (ימין ב-RTL) */}
          <div
            id="my-details-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="הפרטים שלי"
            className="drawer-panel scroll-y"
            style={{
              position: "fixed", insetBlock: 0, insetInlineStart: 0, zIndex: 50,
              width: "min(460px, 94vw)", background: "var(--color-bg)",
              boxShadow: "var(--shadow-lg)", overflowY: "auto", padding: "var(--space-4)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
              <h2 style={{ fontSize: "var(--font-lg)" }}>הפרטים שלי</h2>
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="סגירה">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <MyDetailsPanel facts={facts} />
          </div>
        </>
      )}
    </>
  );
}