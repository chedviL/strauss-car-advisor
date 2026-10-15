// src/server/agent/model.ts
// הגדרת המודל בצד השרת בלבד. המפתח מועבר מפורשות מ-MODEL_API_KEY (ללא הדפסה).
// המזהה ניתן להחלפה דרך MODEL_ID (ברירת מחדל: claude-sonnet-5-5, מאומת זמין
// דרך Models API). אין auto-switch למודל אחר.

import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export const DEFAULT_MODEL_ID = "claude-sonnet-5-5";

/** תקרות ניסוי כדי לשמור על תקציב מוערך של עד ~$1 לקבוצת הריצות. */
export const BUDGET = {
  // מגבלת צעדים (סבבי כלים) לכל תור שיחה.
  maxSteps: 6,
  // תקרת טוקני פלט לכל קריאה.
  maxOutputTokens: 1024,
  // אומדן תמחור (USD per token). עדכני לנקודת הפתיחה; אכיפה היא אומדן, לא תקרת חיוב קשיחה.
  // (יש לעדכן אם התמחור הרשמי שונה; הערך משמש רק להערכת צריכה מצטברת.)
  usdPerInputToken: 3 / 1_000_000,
  usdPerOutputToken: 15 / 1_000_000,
  // תקציב מצטבר מוערך לקבוצת ריצות אוטומטיות.
  maxEstimatedUsd: 1.0,
};

export function getModelId(): string {
  const id = process.env.MODEL_ID;
  return id && id.trim() !== "" ? id.trim() : DEFAULT_MODEL_ID;
}

/** מחזיר LanguageModel מוגדר, או זורק שגיאה מסוננת-סודות אם אין מפתח. */
export function getModel(): LanguageModel {
  const key = process.env.MODEL_API_KEY;
  if (!key || key.trim() === "") {
    throw new Error("MODEL_API_KEY אינו נטען. בדוק את .env.local (נוכחות בלבד).");
  }
  const anthropic = createAnthropic({ apiKey: key });
  return anthropic(getModelId());
}

/** אומדן עלות קריאה בודדת לפי שימוש בטוקנים. */
export function estimateUsd(inputTokens: number, outputTokens: number): number {
  return inputTokens * BUDGET.usdPerInputToken + outputTokens * BUDGET.usdPerOutputToken;
}