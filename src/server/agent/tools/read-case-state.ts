// src/server/agent/tools/read-case-state.ts
// כלי קריאה ממוקד. חושף למודל פרטים מעבר לתקציר המוזרק, לפי בקשה.
// אינו מחזיר אוטומטית את כל התיק/ההיסטוריה. זהות והיקף מהשרת (ToolContext).

import { z } from "zod";
import type { CaseService } from "../../services/case-service.js";
import type { ToolContext, ToolResult } from "../tool-contracts.js";
import { ok, missing } from "../tool-contracts.js";

export const readCaseStateInput = z.object({
  // אילו חלקים נדרשים - מחזירים רק אותם.
  include: z
    .array(z.enum(["facts", "scenarios", "latestComparison"]))
    .min(1),
});
export type ReadCaseStateInput = z.infer<typeof readCaseStateInput>;

export async function readCaseState(
  service: CaseService,
  ctx: ToolContext,
  input: ReadCaseStateInput,
): Promise<ToolResult<Record<string, unknown>>> {
  const state = await service.getCaseState(ctx.caseId, ctx.ownerId);
  if (!state) return missing(["case"], "התיק לא נמצא או אינו בהרשאת הביקור");
  const data: Record<string, unknown> = {};
  if (input.include.includes("facts")) data.facts = state.facts;
  if (input.include.includes("scenarios")) {
    data.scenarios = state.scenarios.map((s) => ({
      id: s.id, role: s.role, route: s.route, vehicleCode: s.vehicleCode,
      participation: s.participation, maintenanceAllowance: s.maintenanceAllowance,
      overrides: s.overrides, revision: s.revision,
    }));
  }
  if (input.include.includes("latestComparison")) {
    data.latestComparison = state.latestComparison;
  }
  return ok(data, { versions: { facts: state.case.factsRevision } });
}