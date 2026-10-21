// src/server/services/facts-validation.ts
// אימות עובדות תיק בשכבת השירות - נקודה אחת לכל המקורות (טופס "הפרטים שלי", שיחה, חילוץ תלוש).
// Server Actions ו-Route Handlers הם נקודות קצה ציבוריות: טיפוסי TS אינם אימות בזמן ריצה.
// null = "לא ידוע" (מותר). ערך חייב להיות מספר סופי בתחום סביר; לעולם לא NaN/שלילי/שיעור >100%.

import { findOccupation } from "../../../data/source/occupations.js";
import type { FactsPatch } from "../repositories/case-repository.js";

export class InvalidFactsError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = "InvalidFactsError";
  }
}

/** גבול עליון הגיוני לסכומים חודשיים (העמודות ב-DB הן numeric(12,2)). */
export const MAX_MONTHLY_AMOUNT = 10_000_000;
export const ELIGIBILITY_GROUPS = ["א", "ב", "ג", "ד"] as const;

const MONEY_FIELDS = ["baseSalary", "commission", "bonus"] as const;
const RATE_FIELDS = ["pensionRate", "trainingRate"] as const;
const ALLOWED_KEYS = new Set<string>([
  ...MONEY_FIELDS, ...RATE_FIELDS, "creditPoints", "qualifyingChildren", "occupationCode", "reportedGroup",
]);

function num(field: string, v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new InvalidFactsError(field, `הערך ב-${field} אינו מספר תקין`);
  return v;
}

/**
 * מאמת patch ומחזיר עותק נקי. שדה undefined מדולג; שדה לא מוכר נדחה.
 * @param allowedKeys הגבלה נוספת (למשל חילוץ תלוש מעדכן רק שדות תלוש).
 */
export function validateFactsPatch(patch: unknown, allowedKeys?: ReadonlySet<string>): FactsPatch {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw new InvalidFactsError("patch", "קלט עדכון לא תקין");
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    if (!ALLOWED_KEYS.has(k) || (allowedKeys && !allowedKeys.has(k))) {
      throw new InvalidFactsError(k, `שדה לא מוכר או לא מותר לעדכון: ${k}`);
    }
    if (v === null) { out[k] = null; continue; }
    if ((MONEY_FIELDS as readonly string[]).includes(k)) {
      const n = num(k, v);
      if (n < 0 || n > MAX_MONTHLY_AMOUNT) throw new InvalidFactsError(k, `הסכום ב-${k} חייב להיות בין 0 ל-${MAX_MONTHLY_AMOUNT.toLocaleString("en-US")}`);
      out[k] = n;
    } else if ((RATE_FIELDS as readonly string[]).includes(k)) {
      const n = num(k, v);
      if (n < 0 || n > 1) throw new InvalidFactsError(k, `שיעור ההפרשה ב-${k} חייב להיות שבר בין 0 ל-1 (למשל 0.06 = 6%)`);
      out[k] = n;
    } else if (k === "creditPoints") {
      const n = num(k, v);
      if (n < 0 || n > 20) throw new InvalidFactsError(k, "נקודות זיכוי חייבות להיות בין 0 ל-20");
      out[k] = n;
    } else if (k === "qualifyingChildren") {
      const n = num(k, v);
      if (!Number.isInteger(n) || n < 0 || n > 20) throw new InvalidFactsError(k, "מספר הילדים חייב להיות מספר שלם בין 0 ל-20");
      out[k] = n;
    } else if (k === "reportedGroup") {
      if (typeof v !== "string" || !(ELIGIBILITY_GROUPS as readonly string[]).includes(v)) {
        throw new InvalidFactsError(k, "קבוצת הזכאות חייבת להיות א, ב, ג או ד");
      }
      out[k] = v;
    } else if (k === "occupationCode") {
      if (typeof v !== "string" || !findOccupation(v)) throw new InvalidFactsError(k, "עיסוק לא מוכר");
      out[k] = v;
    }
  }
  return out as FactsPatch;
}

/** שדות שחילוץ תלוש רשאי לעדכן. */
export const PAYSLIP_FACT_KEYS: ReadonlySet<string> = new Set([
  "baseSalary", "commission", "bonus", "pensionRate", "trainingRate", "creditPoints",
]);
