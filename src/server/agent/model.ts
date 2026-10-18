// src/server/agent/model.ts
// הגדרת המודל בצד השרת בלבד. המפתח מועבר מפורשות מ-MODEL_API_KEY (ללא הדפסה).
// המזהה ניתן להחלפה דרך MODEL_ID (ברירת מחדל: claude-sonnet-5-5, מאומת זמין
// דרך Models API). אין auto-switch למודל אחר.

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

export const DEFAULT_MODEL_ID = "claude-sonnet-5-5";
// חילוץ מסמכים בלבד: Gemini (ספק Google), מפתח נפרד MODEL_API_KEY2. השיחה נשארת Claude.
export const DEFAULT_EXTRACTION_MODEL_ID = "gemini-3.8-flash";

/** תקרות ניסוי כדי לשמור על תקציב מוערך של עד ~$1 לקבוצת הריצות. */
export const BUDGET = {
  // מגבלת צעדים (סבבי כלים) לכל תור שיחה.
  maxSteps: 6,
  // תקרת טוקני פלט לכל קריאה.
  // כולל טוקני thinking (1536) + תשובה. חייב להיות גדול מתקציב ה-thinking.
  maxOutputTokens: 3072,
  // תמחור מאומת ל-claude-sonnet-5-5 (Claude Sonnet 5.5, Models API: lifecycle=active,
  // 1M context) נכון ל-2026: $2 למיליון קלט, $10 למיליון פלט. אומת מול המחיר הרשמי;
  // תוקן מהערך הישן ($3/$15 של Sonnet 4.5) שלא תאם את המודל הפעיל.
  usdPerInputToken: 2 / 1_000_000,
  usdPerOutputToken: 10 / 1_000_000,
  // מחיר קריאת מטמון (cache read) נמוך משמעותית; אם ה-SDK/ספק מדווח cachedInputTokens.
  usdPerCachedInputToken: 0.1 / 1_000_000,
  // תקציב מצטבר מוערך לקבוצת ריצות אוטומטיות.
  maxEstimatedUsd: 1.0,
};

/** דגל ניתן-להחזרה: מסלול מהיר (קריאת מודל אחת + פלט מובנה) להודעות
 *  איסוף/תיקון פשוטות. ברירת מחדל כבוי; CHAT_FAST_PATH=1 מפעיל. */
export function fastPathEnabled(): boolean {
  return process.env.CHAT_FAST_PATH === "1";
}

export type Effort = "low" | "medium" | "high" | "xhigh";
/** רמת ה-effort (adaptive thinking). ברירת מחדל medium; ניתן להחלפה ב-MODEL_EFFORT. */
export function getEffort(): Effort {
  const e = (process.env.MODEL_EFFORT ?? "medium").trim();
  return (["low", "medium", "high", "xhigh"].includes(e) ? e : "medium") as Effort;
}

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

/** מזהה מודל החילוץ (Gemini). ניתן להחלפה ב-EXTRACTION_MODEL_ID. */
export function getExtractionModelId(): string {
  const id = process.env.EXTRACTION_MODEL_ID;
  return id && id.trim() !== "" ? id.trim() : DEFAULT_EXTRACTION_MODEL_ID;
}

/**
 * מודל לחילוץ מסמכים בלבד: ספק Google (Gemini), מפתח נפרד MODEL_API_KEY2.
 * *אינו* משמש לשיחה — השיחה נשארת Claude (getModel). הפרדה מכוונת: ספק/מפתח
 * שונים, כדי לא לערבב חיוב/מכסה בין השניים. זורק שגיאה מסוננת-סוד אם אין מפתח.
 */
export function getExtractionModel(): LanguageModel {
  const key = process.env.MODEL_API_KEY2;
  if (!key || key.trim() === "") {
    throw new Error("MODEL_API_KEY2 (מפתח Gemini לחילוץ) אינו נטען. בדוק את .env.local (נוכחות בלבד).");
  }
  const google = createGoogleGenerativeAI({ apiKey: key });
  return google(getExtractionModelId());
}