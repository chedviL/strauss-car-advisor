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
  const occupation = findOccupation(state.facts.occupationCode);
  if (!occupation) {
    // זכאות לא ידועה - מחזירים חוסר, לא "לא זכאי".
    return missing(["occupationCode"], "לא ניתן לקבוע זכאות ללא עיסוק מאומת");
  }
  const result = service.searchVehicles(occupation, {
    ...(input.propulsion !== undefined ? { propulsion: Number(input.propulsion) as 0 | 1 | 2 | 3 } : {}),
    ...(input.group !== undefined ? { group: input.group } : {}),
  });
  return ok(result, {
    ...(result.unsupportedFilters.length > 0
      ? { message: "חלק מהמסננים אינם נתמכים במקור הנתונים ולא הוחלו: " + result.unsupportedFilters.join(", ") }
      : {}),
  });
}