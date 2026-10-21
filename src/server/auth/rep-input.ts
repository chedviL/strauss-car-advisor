// src/server/auth/rep-input.ts
// אימות קלט מענה נציג בצד השרת. הלקוח (או קריאה ישירה ל-Server Action) אינו מהימן:
// ערך חסר (null) שונה מאפס מפורש (0); מספרים סופיים ולא שליליים בלבד; תאריך אמיתי;
// הערה קצרה. מחזיר ערכים מנורמלים או הודעת שגיאה בעברית.

export const MAX_PARTICIPATION = 100_000;
export const MAX_NOTE_LENGTH = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RepAnswerInput { value: number | null; note: string | null; effectiveFrom: string | null }

export function isUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

function isRealIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2100;
}

export function parseRepAnswer(raw: unknown): { ok: true; answer: RepAnswerInput } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, message: "קלט לא תקין." };
  const r = raw as Record<string, unknown>;

  let value: number | null = null;
  if (r.value !== null && r.value !== undefined) {
    if (typeof r.value !== "number" || !Number.isFinite(r.value)) return { ok: false, message: "ערך ההשתתפות אינו מספר תקין." };
    if (r.value < 0 || r.value > MAX_PARTICIPATION) return { ok: false, message: `ערך ההשתתפות חייב להיות בין 0 ל-${MAX_PARTICIPATION.toLocaleString("he-IL")}.` };
    value = r.value; // 0 הוא ערך מפורש ולא "חסר"
  }

  let note: string | null = null;
  if (r.note !== null && r.note !== undefined) {
    if (typeof r.note !== "string") return { ok: false, message: "הערה לא תקינה." };
    const t = r.note.trim();
    if (t.length > MAX_NOTE_LENGTH) return { ok: false, message: `ההערה ארוכה מדי (עד ${MAX_NOTE_LENGTH} תווים).` };
    note = t === "" ? null : t;
  }

  let effectiveFrom: string | null = null;
  if (r.effectiveFrom !== null && r.effectiveFrom !== undefined && r.effectiveFrom !== "") {
    if (typeof r.effectiveFrom !== "string" || !isRealIsoDate(r.effectiveFrom)) return { ok: false, message: "תאריך התחולה אינו תקין." };
    effectiveFrom = r.effectiveFrom;
  }
  return { ok: true, answer: { value, note, effectiveFrom } };
}
