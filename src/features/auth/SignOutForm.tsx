// src/features/auth/SignOutForm.tsx
"use client";
// טופס יציאה/החלפת חשבון. לפני השליחה מנקה מהלקוח כל מצב אישי של שאלון ההתאמה
// (sessionStorage), כדי שמשתמש/ת אחר/ת באותו דפדפן לא יראה תשובות קודמות.
// הפעולה בשרת (signOut) נשארת ללא שינוי. הסגנון דרך מחלקת nav-btn (ראו globals.css).

import { signOut } from "../../app/auth-actions.js";
import { clearAllMatchState } from "../advisor/vehicle-match/match-state.js";

export function SignOutForm() {
  return (
    <form
      className="signout-form"
      action={signOut}
      onSubmit={() => {
        try { clearAllMatchState(window.sessionStorage); } catch { /* אחסון חסום - אין מה לנקות */ }
      }}
    >
      <button type="submit" className="btn nav-btn" title="מסיים את הסשן ומנקה את הנתונים מהמסך">יציאה</button>
    </form>
  );
}
