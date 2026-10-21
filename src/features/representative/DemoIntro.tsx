// src/features/representative/DemoIntro.tsx
"use client";
// הסבר + כפתור "התנסות כנציג - להדגמה" למשתמש שאינו נציג. הכפתור קורא לפעולת שרת שבודקת את
// דגל ההדגמה; הוא אינו מעניק הרשאת נציג ארגונית אלא גישה מוגבלת לפניות בדיקה.

import "./representative.css";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startRepDemo } from "../../app/actions.js";
import { DEMO_NOTICE } from "./rep-format.js";

export function DemoIntro() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guard = useRef(false);

  async function start() {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await startRepDemo();
      if (res.status === "ok") {
        router.refresh();
        return; // נשארים במצב "טוען" עד שהרענון מחליף את התוכן
      }
      setError(res.status === "disabled" ? "ההתנסות אינה פעילה כרגע." : res.message);
    } catch {
      setError("לא הצלחנו להתחבר לשרת. נסו שוב.");
    }
    guard.current = false;
    setBusy(false);
  }

  return (
    <div className="rep-card">
      <h2>התנסות כנציג</h2>
      <p className="rep-notice" style={{ color: "var(--color-text)" }}>{DEMO_NOTICE}</p>
      <p>
        בהתנסות תוכלו לראות פניות לדוגמה, לצרף פנייה שפתחתם בעצמכם בשיחה, לענות עליה ולקבל התראה במייל
        המאומת שלכם. אין צורך בקוד נוסף או בסיסמה.
      </p>
      <div className="rep-actions">
        <button type="button" className="btn btn-graphite" onClick={start} disabled={busy} aria-describedby="rep-demo-status">
          {busy ? (<><span className="rep-spinner" aria-hidden="true" />מכינים פניות לדוגמה…</>) : "התנסות כנציג — להדגמה"}
        </button>
      </div>
      <div id="rep-demo-status" aria-live="polite">
        {busy && <p className="rep-hint" style={{ marginTop: "var(--space-2)" }}>ההכנה עשויה להימשך כמה שניות.</p>}
        {error && <p className="rep-result" data-tone="err" role="alert"><strong>{error}</strong></p>}
      </div>
    </div>
  );
}
