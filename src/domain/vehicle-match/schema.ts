// src/domain/vehicle-match/schema.ts
// ולידציה משותפת (שרת + אחסון בצד הלקוח) לתשובות השאלון. הלקוח אינו מהימן.

import { z } from "zod";
import type { CompleteAnswers, QuestionnaireAnswers } from "./types.js";

export const completeAnswersSchema = z
  .object({
    passengers: z.enum(["one_two", "three_five", "many"]),
    seatsMin: z.union([z.literal(6), z.literal(7), z.literal(8)]).nullable(),
    cargo: z.enum(["bag", "stroller", "lots"]),
    trips: z.enum(["city", "mixed", "long"]),
    charging: z.enum(["home_work", "public", "none", "unsure"]),
    priority: z.enum(["net", "cargo", "compact", "balanced"]),
  })
  .refine((a) => (a.passengers === "many" ? a.seatsMin !== null : a.seatsMin === null), {
    message: "seatsMin נדרש בדיוק כשנבחר 'יותר מחמישה'",
  });

export const partialAnswersSchema = z.object({
  passengers: z.enum(["one_two", "three_five", "many"]).nullable(),
  seatsMin: z.union([z.literal(6), z.literal(7), z.literal(8)]).nullable(),
  cargo: z.enum(["bag", "stroller", "lots"]).nullable(),
  trips: z.enum(["city", "mixed", "long"]).nullable(),
  charging: z.enum(["home_work", "public", "none", "unsure"]).nullable(),
  priority: z.enum(["net", "cargo", "compact", "balanced"]).nullable(),
});

export const CASE_ID_RE = /^[0-9a-f-]{36}$/i;

export const matchRequestSchema = z.object({
  answers: completeAnswersSchema,
  caseId: z.string().regex(CASE_ID_RE).nullable(),
  /** קבוצת זכאות שנמסרה בשלב הסיום, רק אם אינה ידועה בתיק. */
  groupOverride: z.enum(["א", "ב", "ג", "ד"]).nullable(),
  /** האם לשמור את הקבוצה בפרטי התיק (דרך שירות העובדות הקיים). */
  saveGroup: z.boolean(),
});

/** האם הצעד הנתון מלא ותקין להמשך. */
export function isStepComplete(step: 1 | 2 | 3 | 4, a: QuestionnaireAnswers): boolean {
  switch (step) {
    case 1: return a.passengers !== null && (a.passengers !== "many" || a.seatsMin !== null);
    case 2: return a.cargo !== null;
    case 3: return a.trips !== null && a.charging !== null;
    case 4: return a.priority !== null;
  }
}

export function asComplete(a: QuestionnaireAnswers): CompleteAnswers | null {
  const r = completeAnswersSchema.safeParse(a);
  return r.success ? (r.data as CompleteAnswers) : null;
}
