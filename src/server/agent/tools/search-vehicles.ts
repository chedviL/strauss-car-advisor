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
  /** חיפוש לפי שם מסחרי (חלקי, case-insensitive). מחזיר vehicleCode מזוהה או שגיאת "עמום/לא נמצא". */
  name: z.string().optional(),
  /** זיהוי *כמה* רכבים בקריאה אחת (חוסך סבב): כל שם מזוהה בנפרד (found/ambiguous/not_found). */
  names: z.array(z.string().min(1)).min(1).optional(),
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
  // זיהוי מרובה-שמות בקריאה אחת: מצמצם סבב ספק מיותר כשמוזכרים שני רכבים
  // (למשל "לעבור מ-X ל-Y"), בלי לאחד כתיבות ובלי לוותר על זיהוי מדויק פר-שם.
  if (input.names && input.names.length > 0) {
    const results = [] as Array<Record<string, unknown>>;
    for (const q of input.names) {
      const nr = await service.lookupVehicleByName(q, occupation);
      if (nr.status === "found") {
        const v = nr.vehicle;
        results.push({ nameQuery: q, status: "found", vehicleCode: v.id, name: v.commercialName, group: v.group, propulsion: v.propulsion, valueOfUse: v.valueOfUse, eligibility: nr.eligibility, reasons: nr.reasons });
      } else if (nr.status === "ambiguous") {
        results.push({ nameQuery: q, status: "ambiguous", candidates: nr.matches.map((v) => ({ vehicleCode: v.id, name: v.commercialName, group: v.group })) });
      } else {
        results.push({ nameQuery: q, status: "not_found", candidates: [] });
      }
    }
    return ok({ status: "multi", results }, { message: "זוהו " + results.length + " שמות בקריאה אחת." });
  }
  // זיהוי רכב לפי שם: מחזיר vehicleCode מאומת, or "ambiguous/not_found" — אין ניחוש.
  if (input.name) {
    const nameResult = await service.lookupVehicleByName(input.name, occupation);
    if (nameResult.status === "not_found") {
      return ok({ nameQuery: input.name, status: "not_found", candidates: [] }, {
        message: `לא נמצא רכב בשם "${input.name}". בדוק/י את שם הדגם או חפש/י לפי קבוצה/הנעה.`,
      });
    }
    if (nameResult.status === "ambiguous") {
      return ok({
        nameQuery: input.name, status: "ambiguous",
        candidates: nameResult.matches.map((v) => ({ vehicleCode: v.id, name: v.commercialName, group: v.group })),
      }, { message: `נמצאו ${nameResult.matches.length} רכבים תואמים לשם "${input.name}". ציין/י איזה מהם.` });
    }
    // found: מזהה + זכאות כבר חושבו בשירות
    const { vehicle: v, eligibility, reasons } = nameResult;
    return ok({
      nameQuery: input.name, status: "found",
      vehicleCode: v.id, name: v.commercialName, group: v.group,
      propulsion: v.propulsion, valueOfUse: v.valueOfUse,
      eligibility, reasons,
    });
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