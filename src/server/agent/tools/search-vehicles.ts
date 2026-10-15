// src/server/agent/tools/search-vehicles.ts
// חיפוש רכבים עם זכאות וסיבות. מסנן רק לפי שדות ממקור מאומת.
// פילטר לא-נתמך (מושבים/טווח) מוחזר כ-unsupported, בלי להמציא נתון.

import { z } from "zod";
import type { CaseService } from "../../services/case-service.js";
import type { ToolContext, ToolResult } from "../tool-contracts.js";
import { ok, missing } from "../tool-contracts.js";
import { findOccupation } from "../../../../data/source/occupations.js";

export const searchVehiclesInput = z.object({
  propulsion: z.enum(["0", "1", "2", "3"]).optional(), // 3=חשמלי
  group: z.enum(["א", "ב", "ג", "ד", "משפחתי"]).optional(),
});
export type SearchVehiclesInput = z.infer<typeof searchVehiclesInput>;

export async function searchVehicles(
  service: CaseService,
  ctx: ToolContext,
  input: SearchVehiclesInput,
): Promise<ToolResult<unknown>> {
  const state = await service.getCaseState(ctx.caseId, ctx.ownerId);
  if (!state) return missing(["case"], "התיק לא נמצא");
  // זכאות לרכב חברה נקבעת לפי קבוצת הזכאות. אם העיסוק ידוע - משתמשים בו;
  // אחרת, אם נמסרה קבוצה - מספיק לקבוע זכאות לרכב חברה (לא לוויתור).
  const occFromCode = findOccupation(state.facts.occupationCode);
  const occupation =
    occFromCode ??
    (state.facts.reportedGroup
      ? {
          code: "reported", name: "לפי קבוצה שנמסרה",
          group: state.facts.reportedGroup, carMandatory: false,
          waiverAllowed: false, maintenanceAllowance: 0,
        }
      : undefined);
  if (!occupation) {
    // אין עיסוק ואין קבוצה -> באמת חסר מידע לקביעת זכאות.
    return missing(["reportedGroup"], "כדי לבדוק זכאות לרכבים צריך לדעת את קבוצת הזכאות (או את העיסוק)");
  }
  const result = await service.searchVehicles(occupation, {
    ...(input.propulsion !== undefined ? { propulsion: Number(input.propulsion) as 0 | 1 | 2 | 3 } : {}),
    ...(input.group !== undefined ? { group: input.group } : {}),
  });
  return ok(result, {
    ...(result.unsupportedFilters.length > 0
      ? { message: "חלק מהמסננים אינם נתמכים במקור הנתונים ולא הוחלו: " + result.unsupportedFilters.join(", ") }
      : {}),
  });
}