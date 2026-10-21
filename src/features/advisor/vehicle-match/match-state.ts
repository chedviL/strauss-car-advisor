// src/features/advisor/vehicle-match/match-state.ts
// שמירת מצב השאלון בצד הלקוח (sessionStorage), מופרדת לפי משתמש/ת ולפי בירור.
// - המפתח כולל את מזהה המשתמש ואת מזהה הבירור ("new" = שיחה חדשה שטרם נפתח לה תיק).
// - נשמרות רק העדפות (תשובות/שלב/קבוצה שנבחרה). לא נשמרים שכר, נטו או תוצאות.
// - ביציאה מהחשבון מנקים את כל המפתחות (clearAllMatchState).
// פונקציות טהורות מעל ממשק Storage מצומצם, כדי שיהיו ניתנות לבדיקה בלי דפדפן.

import { partialAnswersSchema } from "../../../domain/vehicle-match/schema.js";
import { EMPTY_ANSWERS, type QuestionnaireAnswers } from "../../../domain/vehicle-match/types.js";
import { z } from "zod";

export const STORAGE_PREFIX = "strauss:vehicle-match:v1:";

export type MatchView = "intro" | "questions" | "results";
export type GroupChoice = "א" | "ב" | "ג" | "ד";

export interface PersistedMatchState {
  v: 1;
  view: MatchView;
  step: 1 | 2 | 3 | 4;
  answers: QuestionnaireAnswers;
  groupChoice: GroupChoice | null;
}

export const INITIAL_STATE: PersistedMatchState = {
  v: 1, view: "intro", step: 1, answers: EMPTY_ANSWERS, groupChoice: null,
};

const persistedSchema = z.object({
  v: z.literal(1),
  view: z.enum(["intro", "questions", "results"]),
  step: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  answers: partialAnswersSchema,
  groupChoice: z.enum(["א", "ב", "ג", "ד"]).nullable(),
});

type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "setItem" | "removeItem">;
type ScanStorage = Pick<Storage, "key" | "removeItem"> & { readonly length: number };

export function scopeKey(userId: string, caseId: string | null): string {
  return `${STORAGE_PREFIX}${userId}:${caseId ?? "new"}`;
}

export function loadMatchState(storage: ReadStorage, key: string): PersistedMatchState | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = persistedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as PersistedMatchState) : null;
  } catch {
    return null;
  }
}

export function saveMatchState(storage: WriteStorage, key: string, state: PersistedMatchState): void {
  try {
    storage.setItem(key, JSON.stringify(state));
  } catch {
    // אחסון חסום/מלא - המצב נשמר בזיכרון בלבד.
  }
}

export function clearMatchState(storage: WriteStorage, key: string): void {
  try { storage.removeItem(key); } catch { /* ignore */ }
}

/** מעבר משיחה חדשה (new) לבירור שנפתח לה: מעביר את המצב ומוחק את המפתח הישן. */
export function moveMatchState(storage: ReadStorage & WriteStorage, fromKey: string, toKey: string): void {
  if (fromKey === toKey) return;
  const s = loadMatchState(storage, fromKey);
  if (!s) return;
  if (!loadMatchState(storage, toKey)) saveMatchState(storage, toKey, s);
  clearMatchState(storage, fromKey);
}

// ───────────── מטמון תוצאות בזיכרון בלבד (לא נכתב ל-storage) ─────────────
// כדי שפתיחה מחדש של המגירה תציג את התוצאות מיד (ואז תתרענן ברקע). המפתח כולל משתמש/ת
// ובירור; ביציאה (clearAllMatchState) המטמון מתרוקן. הערך כולל נטו, ולכן אינו נשמר בדיסק.
const resultsCache = new Map<string, { sig: string; data: unknown }>();
export function answersSignature(s: Pick<PersistedMatchState, "answers" | "groupChoice">): string {
  return JSON.stringify([s.answers, s.groupChoice]);
}
export function getCachedResult<T>(key: string, sig: string): T | null {
  const hit = resultsCache.get(key);
  return hit && hit.sig === sig ? (hit.data as T) : null;
}
export function setCachedResult(key: string, sig: string, data: unknown): void {
  resultsCache.set(key, { sig, data });
}

/** "שיחה חדשה": מנקה את מצב השאלון של שיחות חדשות שטרם נפתח להן תיק (מפתחות :new). */
export function clearNewScopeState(storage: ScanStorage): number {
  for (const k of [...resultsCache.keys()]) if (k.endsWith(":new")) resultsCache.delete(k);
  const doomed: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX) && k.endsWith(":new")) doomed.push(k);
    }
    for (const k of doomed) storage.removeItem(k);
  } catch { /* ignore */ }
  return doomed.length;
}

/** יציאה/החלפת חשבון: מוחק כל מצב שאלון אישי מהלקוח (של כל המשתמשים והבירורים). */
export function clearAllMatchState(storage: ScanStorage): number {
  resultsCache.clear();
  const doomed: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) doomed.push(k);
    }
    for (const k of doomed) storage.removeItem(k);
  } catch { /* ignore */ }
  return doomed.length;
}

// ───────────── טיוטת הודעה: הכנת בקשת השוואה בלי לדרוס ─────────────

export function comparePrompt(vehicleName: string): string {
  return `אשמח להשוות את ${vehicleName} לרכב הנוכחי שלי.`;
}

export type PrefillPlan =
  | { kind: "set"; text: string }
  | { kind: "ask"; draft: string; proposed: string };

/** תיבה ריקה => מציבים. תיבה עם טיוטה => לא דורסים; מבקשים החלטה. */
export function planPrefill(currentDraft: string, proposed: string): PrefillPlan {
  return currentDraft.trim() === "" ? { kind: "set", text: proposed } : { kind: "ask", draft: currentDraft, proposed };
}
