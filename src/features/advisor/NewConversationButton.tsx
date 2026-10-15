// src/features/advisor/NewConversationButton.tsx
"use client";
// כפתור "שיחה חדשה": פותח תיק נפרד; ההיסטוריה של התיק הקודם נשמרת במסד.

import { useTransition } from "react";
import { newConversation } from "../../app/actions.js";

export function NewConversationButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="btn"
      disabled={pending}
      onClick={() => startTransition(() => newConversation())}
      aria-label="שיחה חדשה"
      title="פותח שיחה חדשה; ההיסטוריה הקודמת נשמרת"
    >
      {pending ? "פותח…" : "שיחה חדשה"}
    </button>
  );
}