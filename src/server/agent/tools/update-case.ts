// src/server/agent/tools/update-case.ts
// עדכון עובדות משותפות על העובד (תיקון עובדה אמיתית, לא סימולציה).
// פעולות ושדות מרשימה סגורה בלבד - אין JSON path שרירותי. בדיקת גרסה.
// clear מפורש != אפס. חילוץ כמה שדות מהודעה אחת -> עדכון יחד לאחר ולידציה.

import { z } from "zod";
import type { CaseService } from "../../services/case-service.js";
import type { FactsPatch } from "../../repositories/case-repository.js";
import type { ToolContext, ToolResult } from "../tool-contracts.js";
import { ok, conflict, missing } from "../tool-contracts.js";

// שדות שכר/פרופיל מותרים לעדכון עובדה משותפת. אין קבוצת זכאות דרך כאן בלי בירור.
const numericField = z.number().finite().nonnegative();
export const updateCaseInput = z.object({
  expectedFactsRevision: z.number().int().nonnegative(),
  set: z
    .object({
      baseSalary: numericField.optional(),
      commission: numericField.optional(),
      bonus: numericField.optional(),
      pensionRate: z.number().min(0).max(1).optional(),
      trainingRate: z.number().min(0).max(1).optional(),
      creditPoints: z.number().min(0).max(20).optional(),
      qualifyingChildren: z.number().int().min(0).max(20).optional(),
      occupationCode: z.string().min(1).optional(),
      reportedGroup: z.enum(["א", "ב", "ג", "ד"]).optional(),
    })
    .optional(),
  // clear מפורש: החזרת שדה ל-unknown (null), שונה מאפס.
  clear: z.array(z.enum(["commission", "bonus", "occupationCode"])).optional(),
});
export type UpdateCaseInput = z.infer<typeof updateCaseInput>;

export async function updateCase(
  service: CaseService,
  ctx: ToolContext,
  input: UpdateCaseInput,
): Promise<ToolResult<{ factsRevision: number }>> {
  const patch: FactsPatch = {};
  if (input.set) {
    for (const [k, v] of Object.entries(input.set)) {
      if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
    }
  }
  if (input.clear) {
    for (const k of input.clear) (patch as Record<string, unknown>)[k] = null;
  }
  if (Object.keys(patch).length === 0) {
    return missing(["set|clear"], "לא נמסרו שדות לעדכון");
  }
  const res = await service.updateFacts(
    ctx.caseId, ctx.ownerId, patch, input.expectedFactsRevision,
  );
  if (res.status === "conflict") {
    return conflict(
      "העובדות עודכנו בינתיים; יש לטעון מצב עדכני לפני עדכון חוזר",
      { facts: res.currentRevision },
    );
  }
  return ok({ factsRevision: res.factsRevision }, { versions: { facts: res.factsRevision } });
}