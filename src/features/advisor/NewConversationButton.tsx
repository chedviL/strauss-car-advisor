// src/features/advisor/NewConversationButton.tsx
"use client";
// כפתור "שיחה חדשה": מנקה את התיק הפעיל ומבצע טעינה מלאה של העמוד כדי לאפס
// גם את מצב ה-chat בצד הלקוח (useChat). תהליך קצר: ניקוי + התחלה נקייה.

import { useState } from "react";
import { newConversation } from "../../app/actions.js";

export function NewConversationButton() {
  const [pending, setPending] = useState(false);
  async function onClick() {
    setPending(true);
    try {
      await newConversation();
    } finally {
      // טעינה מלאה: מאפסת את היסטוריית ה-chat בלקוח ומציגה מסך פתיחה נקי.
      window.location.href = "/";
    }
  }
  return (
    <button
      className="btn"
      disabled={pending}
      onClick={onClick}
      aria-label="שיחה חדשה"
      title="מנקה את השיחה הנוכחית ומתחיל חדשה"
    >
      {pending ? "מתחיל…" : "שיחה חדשה"}
    </button>
  );
}