// src/server/agent/model.ts
// הגדרת המודל בצד השרת בלבד. מפתחות נטענים מרשימה (CLAUDE_API_KEY_1..N / GEMINI_API_KEY_1..N)
// עם backward-compatibility ל-MODEL_API_KEY / MODEL_API_KEY2 / MODEL_API_KEY3 הישנים.
// אין auto-switch למודל אחר. ה-pool בוחר מפתח לפי round-robin; מפתח שנכשל בחיוב/מכסה
// נדחה אוטומטית לקצה הרשימה (cooldown per-process).

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

export const DEFAULT_MODEL_ID = "claude-sonnet-5-5";
// חילוץ מסמכים בלבד: Gemini (ספק Google), מפתחות נפרדים. השיחה נשארת Claude.
// gemini-flash-lite-latest: alias יציב שמצביע תמיד על הגרסה הזמינה הנוכחית.
// gemini-3.8-flash נכשל ב-generateObject (מחזיר תגובה ריקה/לא-parseable, ~70s).
export const DEFAULT_EXTRACTION_MODEL_ID = "gemini-flash-lite-latest";

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

// ---------------------------------------------------------------------------
// Key pool — round-robin עם cooldown per-key לאחר כשל חיוב/מכסה
// ---------------------------------------------------------------------------

/** משך ה-cooldown (ms) למפתח אחרי כשל חיוב/מכסה. ברירת מחדל: 10 דקות. */
const KEY_COOLDOWN_MS = 10 * 60 * 1_000;

/** מצב per-key (per-process). לא גלובלי: cold-start מאפס. */
const keyCooldowns = new Map<string, number>(); // key -> blockedUntil timestamp
const keyCounters  = new Map<string, number>(); // poolId -> lastUsedIndex

/**
 * בונה רשימת מפתחות ייחודיים-ותקינים מסדרת משתני סביבה.
 *
 * לוגיקת חיפוש (לפי סדר קדימויות):
 *  1. CLAUDE_API_KEY_1, CLAUDE_API_KEY_2, ... CLAUDE_API_KEY_N  (עד MAX_KEYS)
 *     (או GEMINI_API_KEY_1...N עבור ספק Gemini)
 *  2. fallback לשמות הישנים שמועברים ב-legacyVars, בסדר שהוגדר.
 *
 * @param prefix   "CLAUDE_API_KEY" | "GEMINI_API_KEY"
 * @param legacyVars שמות משתני סביבה ישנים לתאימות לאחור (בסדר עדיפות יורד)
 * @param maxKeys  מספר מקסימלי של ערכים להסרוק (ברירת מחדל 10)
 */
function buildKeyPool(prefix: string, legacyVars: string[], maxKeys = 10): string[] {
  const seen = new Set<string>();
  const pool: string[] = [];

  const add = (v: string | undefined) => {
    const k = v?.trim();
    if (k && !seen.has(k)) { seen.add(k); pool.push(k); }
  };

  // 1. מפתחות ממוספרים חדשים
  for (let i = 1; i <= maxKeys; i++) {
    add(process.env[`${prefix}_${i}`]);
  }

  // 2. מפתחות ישנים (backward-compat)
  for (const name of legacyVars) {
    add(process.env[name]);
  }

  return pool;
}

/**
 * בוחר את המפתח הבא מהpool לפי round-robin, תוך דילוג על מפתחות ב-cooldown.
 * אם כולם ב-cooldown — מחזיר את המפתח עם ה-cooldown הקצר ביותר (פחות גרוע).
 *
 * @param poolId  מזהה ייחודי לכל pool (לשמירת counter נפרד)
 * @param pool    רשימת המפתחות
 * @returns המפתח שנבחר, או null אם ה-pool ריק
 */
function pickKey(poolId: string, pool: string[]): string | null {
  if (pool.length === 0) return null;

  const now = Date.now();
  const start = keyCounters.get(poolId) ?? 0;

  // עובר על הpool מה-index שאחרי ה-index האחרון שהשתמשנו בו
  for (let offset = 0; offset < pool.length; offset++) {
    const idx = (start + offset) % pool.length;
    const key = pool[idx]!;
    const blockedUntil = keyCooldowns.get(key) ?? 0;
    if (now >= blockedUntil) {
      keyCounters.set(poolId, idx + 1);
      return key;
    }
  }

  // כולם ב-cooldown: בחר את הכי-פחות-חסום
  // pool.length > 0 מובטח בתחילת הפונקציה, אך TypeScript לא מסיק זאת עבור pool[0]
  let bestKey: string = pool[0] as string;
  let bestUntil = keyCooldowns.get(bestKey) ?? 0;
  for (const k of pool) {
    const u = keyCooldowns.get(k) ?? 0;
    if (u < bestUntil) { bestKey = k; bestUntil = u; }
  }
  console.warn(`[model] כל מפתחות ה-pool "${poolId}" ב-cooldown; משתמש בפחות-חסום (יפוג בעוד ${Math.round((bestUntil - now) / 1000)}s)`);
  return bestKey;
}

/**
 * מסמן מפתח כ"נכשל" (חיוב/מכסה) — ידחה לקצה ה-pool ל-KEY_COOLDOWN_MS.
 * קורא לזה מקוד שמטפל בשגיאת ספק (chat/route.ts, payslip-extract.ts).
 */
export function markKeyFailed(key: string): void {
  keyCooldowns.set(key, Date.now() + KEY_COOLDOWN_MS);
  console.warn(`[model] מפתח API נכשל — ב-cooldown ל-${KEY_COOLDOWN_MS / 60_000} דקות`);
}

// ---------------------------------------------------------------------------
// Pool מוגדרים — Claude ו-Gemini
// ---------------------------------------------------------------------------

/** Pool מפתחות Claude (Anthropic). מחושב פעם אחת per-process. */
function getClaudePool(): string[] {
  return buildKeyPool("CLAUDE_API_KEY", ["MODEL_API_KEY"]);
}

/** Pool מפתחות Gemini (Google). מחושב פעם אחת per-process. */
function getGeminiPool(): string[] {
  return buildKeyPool("GEMINI_API_KEY", ["MODEL_API_KEY3", "MODEL_API_KEY2"]);
}

// ---------------------------------------------------------------------------
// Public API — זהה לממשק הישן; הלוגיקה הפנימית עברה ל-pool
// ---------------------------------------------------------------------------

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

/**
 * מחזיר LanguageModel מוגדר (Claude). בוחר מפתח לפי round-robin מה-pool.
 * זורק שגיאה מסוננת-סודות אם אין אף מפתח מוגדר.
 */
export function getModel(): LanguageModel {
  const pool = getClaudePool();
  const key = pickKey("claude", pool);
  if (!key) {
    throw new Error(
      "לא נמצא אף מפתח Claude. הגדר CLAUDE_API_KEY_1 (ו/או CLAUDE_API_KEY_2..N) ב-.env.local."
    );
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
 * מחזיר את המפתח הבא מה-pool של Gemini (round-robin).
 * Backward-compatible: MODEL_API_KEY3 → MODEL_API_KEY2 → GEMINI_API_KEY_1..N.
 */
export function getExtractionApiKey(): string | null {
  const pool = getGeminiPool();
  return pickKey("gemini", pool);
}

// מודל שיחה גיבוי במכסה החינמית של Gemini (תומך כלים). *אינו* ברירת המחדל -
// השיחה נשארת Claude; זה רק fallback לכשל ספק. מפתח צד-שרת בלבד (GEMINI pool),
// בלי חיוב. gemini-2.5-flash הוא free-tier ותומך function-calling.
export const DEFAULT_FALLBACK_CHAT_MODEL_ID = "gemini-3.8-flash"; // זמין בחשבון זה (כמו החילוץ); gemini-2.5-flash אינו זמין למשתמשים חדשים.
export function getFallbackChatModelId(): string {
  const id = process.env.FALLBACK_CHAT_MODEL_ID;
  return id && id.trim() !== "" ? id.trim() : DEFAULT_FALLBACK_CHAT_MODEL_ID;
}
/** מחזיר מודל גיבוי לשיחה (Gemini free-tier) או null אם אין מפתח. לא זורק. */
export function getFallbackChatModel(): LanguageModel | null {
  const key = getExtractionApiKey(); // אותו pool Gemini
  if (!key) return null;
  const google = createGoogleGenerativeAI({ apiKey: key });
  return google(getFallbackChatModelId());
}

export function getExtractionModel(): LanguageModel {
  const key = getExtractionApiKey();
  if (!key) {
    throw new Error(
      "לא נמצא אף מפתח Gemini. הגדר GEMINI_API_KEY_1 (ו/או GEMINI_API_KEY_2..N) ב-.env.local."
    );
  }
  const google = createGoogleGenerativeAI({ apiKey: key });
  return google(getExtractionModelId());
}