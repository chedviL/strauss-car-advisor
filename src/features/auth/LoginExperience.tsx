// src/features/auth/LoginExperience.tsx
"use client";
// מתזמן את מסך הכניסה בשני מצבים (מחשב: איור משמאל + טופס מימין; נייד: איור בתוך
// זרימת הטופס מתחת לכפתור). מחזיק את מצבי ה-shell שמניעים את שכבת האפקטים:
//   is-entering - רצף הופעה חד-פעמי בטעינה.
//   is-calm     - בזמן הקלדה/מיקוד בשדה: מרגיע נצנוצים ופולסים.
//   is-busy     - בזמן בקשת שרת (שליחה/אימות): מגביר מעט את הפולסים.
// המצבים נשלטים ב-CSS; כאן רק מצרפים מחלקות ומעבירים callbacks ל-LoginForm.
// לוגיקת ההתחברות כולה ב-LoginForm.

import { useEffect, useState } from "react";
import { CarVisual } from "./CarVisual.js";
import { LoginForm } from "./LoginForm.js";

export function LoginExperience({ configured }: { configured: boolean }) {
  const [entering, setEntering] = useState(true);
  const [calm, setCalm] = useState(false);
  const [busy, setBusy] = useState(false);

  // רצף ההופעה רץ פעם אחת; מסירים את המחלקה אחרי שהרצף הסתיים (~1s) כדי שלא
  // יופעל מחדש ולא ישפיע על מעברים מאוחרים.
  useEffect(() => {
    // משך הרצף: השהיית הקבוצה האחרונה (~480ms) + משך האנימציה (~620ms) ומרווח.
    const t = setTimeout(() => setEntering(false), 1300);
    return () => clearTimeout(t);
  }, []);

  const shellClass = [
    "login-shell",
    entering ? "is-entering" : "",
    calm ? "is-calm" : "",
    busy ? "is-busy" : "",
  ].filter(Boolean).join(" ");

  return (
    <main className={shellClass}>
      {/* עמודת האיור - מחשב בלבד (מוסתרת בנייד ב-CSS). */}
      <section className="login-visual">
        <CarVisual mode="desktop" />
      </section>

      {/* עמודת הטופס. בנייד האיור מופיע בתוכה (mode="mobile") מתחת לכפתור. */}
      <section className="login-panel">
        <div className="login-panel-inner">
          <LoginForm configured={configured} onCalm={setCalm} onBusy={setBusy} />
        </div>
      </section>
    </main>
  );
}
