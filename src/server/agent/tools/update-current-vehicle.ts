// src/server/agent/tools/update-current-vehicle.ts
// עדכון הרכב וההשתתפות *הנוכחיים* (baseline) של העובד/ת - "הרכב שלי".
// זאת עובדת-מצב, לא בקשת השוואה: "הרכב שלי קורולה" / "אני משלם 300 השתתפות"
// מעדכן את baseline. *לא* משמש ל"לעבור ל-ATTO 3" (זו חלופה -> manageScenarios),
// ולא לסימולציה. שומר שדות קיימים שלא נמסרו (אינו מאפס).

import { z } from "zod";
import type { CaseService } from "../../services/case-service.js";
import type { ToolContext, ToolResult } from "../tool-contracts.js";
import { ok, missing } from "../tool-contracts.js";

export const updateCurrentVehicleInput = z.object({
  // כל השדות אופציונליים; שדה שלא נמסר נשמר כפי שהוא (ירושה מה-baseline הקיים).
  route: z.enum(["company_car", "family", "waiver"]).optional(),
  vehicleCode: z.string().min(1).nullable().optional(),
  participation: z.number().finite().nonnegative().nullable().optional(),
  maintenanceAllowance: z.number().finite().nonnegative().optional(),
});
export type UpdateCurrentVehicleInput = z.infer<typeof updateCurrentVehicleInput>;

export async function updateCurrentVehicle(
  service: CaseService,
  ctx: ToolContext,
  input: UpdateCurrentVehicleInput,
): Promise<ToolResult<{ scenarioId: string; vehicleCode: string | null; participation: number | null }>> {
  if (
    input.route === undefined && input.vehicleCode === undefined &&
    input.participation === undefined && input.maintenanceAllowance === undefined
  ) {
    return missing(["route|vehicleCode|participation|maintenanceAllowance"], "לא נמסר דבר לעדכון המצב הנוכחי");
  }
  // ירושה מה-baseline הקיים לשדות שלא נמסרו (אינו מאפס ערכים קיימים).
  const state = await service.getCaseState(ctx.caseId, ctx.ownerId);
  if (!state) return missing(["case"], "התיק לא נמצא");
  const base = state.scenarios.find((s) => s.role === "baseline");

  const scenario = await service.updateBaselineVehicle(ctx.caseId, ctx.ownerId, {
    route: input.route ?? base?.route ?? "company_car",
    vehicleCode: input.vehicleCode !== undefined ? input.vehicleCode : (base?.vehicleCode ?? null),
    participation: input.participation !== undefined ? input.participation : (base?.participation ?? null),
    maintenanceAllowance: input.maintenanceAllowance ?? base?.maintenanceAllowance ?? 0,
  });
  return ok(
    { scenarioId: scenario.id, vehicleCode: scenario.vehicleCode, participation: scenario.participation },
    { message: "עודכן המצב הנוכחי (baseline)" },
  );
}
