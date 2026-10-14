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
  operation: z.enum(["set_alternative", "clear_overrides"]),
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
    const scenario = await service.pickAlternative(ctx.caseId, ctx.ownerId, {
      role: "alternative",
      route: input.route,
      vehicleCode: input.vehicleCode ?? null,
      participation: input.participation ?? null,
      maintenanceAllowance: input.maintenanceAllowance ?? 0,
      overrides,
    });
    return ok(
      { scenarioId: scenario.id, overrides: scenario.overrides },
      { message: Object.keys(scenario.overrides).length > 0 ? "נשמר תרחיש היפותטי (override ברמת התרחיש; השכר הנוכחי לא השתנה)" : "נשמרה חלופה" },
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