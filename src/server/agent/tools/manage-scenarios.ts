// src/server/agent/tools/manage-scenarios.ts
// ניהול חלופות: יצירה/עדכון/ארכוב וניהול שינוי היפותטי בתוך תרחיש.
// override היפותטי = שדות שכר בלבד; אין קבוצת זכאות ואין עקיפת רכב חובה.
// הסרת override = חזרה לירושה (לא אפס). שינוי אינו משנה את baseline או העובדות.

import { z } from "zod";
import type { CaseService } from "../../services/case-service.js";
import type { ToolContext, ToolResult } from "../tool-contracts.js";
import { ok, missing } from "../tool-contracts.js";
import type { ScenarioOverrides } from "../../../domain/contracts/case.js";

const salaryOverride = z.object({
  baseSalary: z.number().finite().nonnegative().optional(),
  commission: z.number().finite().nonnegative().optional(),
  bonus: z.number().finite().nonnegative().optional(),
});

export const manageScenariosInput = z.object({
  operation: z.enum(["set_alternative", "update_overrides", "clear_overrides"]),
  route: z.enum(["company_car", "family", "waiver"]).optional(),
  vehicleCode: z.string().min(1).nullable().optional(),
  participation: z.number().finite().nonnegative().nullable().optional(),
  maintenanceAllowance: z.number().finite().nonnegative().optional(),
  // שינוי היפותטי ברמת התרחיש (שדות שכר בלבד). השמטת מפתח = חזרה לירושה.
  overrides: salaryOverride.optional(),
});
export type ManageScenariosInput = z.infer<typeof manageScenariosInput>;

export async function manageScenarios(
  service: CaseService,
  ctx: ToolContext,
  input: ManageScenariosInput,
): Promise<ToolResult<{ scenarioId: string; overrides: ScenarioOverrides }>> {
  if (input.operation === "set_alternative") {
    if (!input.route) return missing(["route"], "חסר מסלול לחלופה");
    const overrides: ScenarioOverrides = {};
    if (input.overrides) {
      for (const [k, v] of Object.entries(input.overrides)) {
        if (v !== undefined) (overrides as Record<string, number>)[k] = v;
      }
    }
    // השתתפות בחלופת רכב: ערך מספרי שנמסר משמש כפי שהוא. כשלא נמסר ערך מספרי -
    // *בין אם הושמט (undefined) ובין אם המודל שלח null* - הוא יורש *במפורש* את ההשתתפות
    // הנוכחית (baseline) ונשמר כערך קונקרטי, ולא כ-null שמסתמך בשקט על ברירת מחדל של
    // הקטלוג. (קודם null נשמר כמות שהוא, והחישוב נפל על ברירת המחדל של הדגם בלי שהמשתמש/ת
    // בחר/ה בכך - בניגוד להוראה "אל תשאיר null בהסתמך על ברירת מחדל... אל תמציא".)
    // אם גם ההשתתפות הנוכחית אינה ידועה - לא ממציאים: מחזירים "חסר" כדי שהמודל ישאל.
    // ויתור אינו דורש השתתפות (אפס מובנה).
    let participation: number | null;
    if (typeof input.participation === "number") {
      participation = input.participation;
    } else if (input.route === "waiver") {
      participation = null; // ויתור: אין השתתפות ברכב; המנוע מציב אפס מובנה
    } else {
      const cur = await service.getCaseState(ctx.caseId, ctx.ownerId);
      const baseP = cur?.scenarios.find((s) => s.role === "baseline")?.participation ?? null;
      if (baseP === null) {
        return missing(
          ["participation"],
          "ההשתתפות ברכב החדש לא נמסרה וגם ההשתתפות הנוכחית אינה ידועה. יש לשאול את העובד/ת, " +
            "ואם אינו/ה יודע/ת - לברר מול הנציג (openInquiry). לא להניח ערך.",
        );
      }
      participation = baseP; // ירושה מפורשת מהמצב הנוכחי
    }
    const scenario = await service.pickAlternative(ctx.caseId, ctx.ownerId, {
      role: "alternative",
      route: input.route,
      vehicleCode: input.vehicleCode ?? null,
      participation,
      maintenanceAllowance: input.maintenanceAllowance ?? 0,
      overrides,
    });
    return ok(
      { scenarioId: scenario.id, overrides: scenario.overrides },
      { message: Object.keys(scenario.overrides).length > 0 ? "נשמר תרחיש היפותטי (override ברמת התרחיש; השכר הנוכחי לא השתנה)" : "נשמרה חלופה" },
    );
  }
  // update_overrides: החלת/עדכון override שכר על החלופה הקיימת, בלי לדרוש
  // route/vehicle. לסימולציית שכר טהורה ("מה אם השכר יעלה ל-X") כשטרם נבחר רכב,
  // יורש מה-baseline. מיזוג עם override קיים (לא דורס שדות אחרים).
  if (input.operation === "update_overrides") {
    const state = await service.getCaseState(ctx.caseId, ctx.ownerId);
    if (!state) return missing(["case"], "התיק לא נמצא");
    const alt = state.scenarios.find((s) => s.role === "alternative");
    const base = state.scenarios.find((s) => s.role === "baseline");
    const inherit = alt ?? base;
    if (!inherit) return missing(["scenario"], "אין תרחיש בסיס לירושה");
    const merged: ScenarioOverrides = { ...(alt?.overrides ?? {}) };
    if (input.overrides) {
      for (const [k, v] of Object.entries(input.overrides)) {
        if (v !== undefined) (merged as Record<string, number>)[k] = v;
      }
    }
    const scenario = await service.pickAlternative(ctx.caseId, ctx.ownerId, {
      role: "alternative",
      route: alt?.route ?? inherit.route,
      vehicleCode: alt?.vehicleCode ?? inherit.vehicleCode,
      participation: alt?.participation ?? inherit.participation,
      maintenanceAllowance: alt?.maintenanceAllowance ?? inherit.maintenanceAllowance,
      overrides: merged,
    });
    return ok(
      { scenarioId: scenario.id, overrides: scenario.overrides },
      { message: "נשמר תרחיש היפותטי (override שכר ברמת התרחיש; הנתונים האמיתיים לא השתנו)" },
    );
  }

  // clear_overrides: הסרת ה-override מהחלופה הקיימת -> חזרה לירושה מלאה.
  const state = await service.getCaseState(ctx.caseId, ctx.ownerId);
  if (!state) return missing(["case"], "התיק לא נמצא");
  const alt = state.scenarios.find((s) => s.role === "alternative");
  if (!alt) return missing(["alternative"], "אין חלופה פעילה לניקוי override");
  const scenario = await service.pickAlternative(ctx.caseId, ctx.ownerId, {
    role: "alternative",
    route: alt.route,
    vehicleCode: alt.vehicleCode,
    participation: alt.participation,
    maintenanceAllowance: alt.maintenanceAllowance,
    overrides: {},
  });
  return ok(
    { scenarioId: scenario.id, overrides: scenario.overrides },
    { message: "ה-override הוסר; החלופה חזרה לירושה מהעובדות המשותפות" },
  );
}