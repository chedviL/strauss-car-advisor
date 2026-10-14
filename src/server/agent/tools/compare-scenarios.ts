// src/server/agent/tools/compare-scenarios.ts
// השוואה גמישה: explicit (רשימת רכבים/ויתור) או discover (סריקה + מיון/סינון לפי נטו).
// חישוב בקוד באצווה אחת מול תמונת קלט עקבית. ברירת מחדל: היום מול חלופה אחת.
// כיסוי חלקי אינו מוצג כ"הטוב ביותר מכל האפשרויות".

import { z } from "zod";
import type { CaseService, CompareRequest } from "../../services/case-service.js";
import type { ToolContext, ToolResult } from "../tool-contracts.js";
import { ok, missing } from "../tool-contracts.js";
import { findOccupation } from "../../../../data/source/occupations.js";

const candidate = z.object({
  label: z.string().min(1),
  route: z.enum(["company_car", "family", "waiver"]),
  vehicleCode: z.string().min(1).nullable(),
  participation: z.number().finite().nonnegative().nullable(),
  maintenanceAllowance: z.number().finite().nonnegative().default(0),
  overrides: z
    .object({
      baseSalary: z.number().finite().nonnegative().optional(),
      commission: z.number().finite().nonnegative().optional(),
      bonus: z.number().finite().nonnegative().optional(),
    })
    .optional(),
});

export const compareScenariosInput = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("explicit"),
    candidates: z.array(candidate).min(1),
    minNetDelta: z.number().optional(),
  }),
  z.object({
    mode: z.literal("discover"),
    includeWaiver: z.boolean().optional(),
    minNetDelta: z.number().optional(),
  }),
]);
export type CompareScenariosInput = z.infer<typeof compareScenariosInput>;

export async function compareScenarios(
  service: CaseService,
  ctx: ToolContext,
  input: CompareScenariosInput,
): Promise<ToolResult<unknown>> {
  const state = await service.getCaseState(ctx.caseId, ctx.ownerId);
  if (!state) return missing(["case"], "התיק לא נמצא");
  const occupation = findOccupation(state.facts.occupationCode);

  let request: CompareRequest;
  if (input.mode === "explicit") {
    request = {
      mode: "explicit",
      candidates: input.candidates.map((c) => {
        const ov: Record<string, number> = {};
        if (c.overrides) for (const [k, v] of Object.entries(c.overrides)) if (v !== undefined) ov[k] = v;
        return {
          label: c.label, route: c.route, vehicleCode: c.vehicleCode,
          participation: c.participation, maintenanceAllowance: c.maintenanceAllowance,
          ...(Object.keys(ov).length > 0 ? { overrides: ov } : {}),
        };
      }),
      ...(occupation ? { occupation } : {}),
      ...(input.minNetDelta !== undefined ? { minNetDelta: input.minNetDelta } : {}),
    };
  } else {
    const waiverMaintenance = occupation?.waiverAllowed ? occupation.maintenanceAllowance : 0;
    request = {
      mode: "discover",
      includeWaiver: input.includeWaiver ?? false,
      waiverMaintenance,
      ...(occupation ? { occupation } : {}),
      ...(input.minNetDelta !== undefined ? { minNetDelta: input.minNetDelta } : {}),
    };
  }

  const result = await service.compareScenarios(ctx.caseId, ctx.ownerId, request);
  if (result.status === "missing_data") {
    return missing(result.missingFields, "חסרים נתונים ל-baseline; אין להציג נטו עד השלמתם");
  }
  const partial = result.coverage.excluded + result.coverage.incomplete > 0;
  return ok(result, {
    ...(partial
      ? { message: "כיסוי חלקי: חלק מהחלופות נפסלו או חסרות נתונים; הדירוג אינו מייצג את כל האפשרויות" }
      : {}),
  });
}