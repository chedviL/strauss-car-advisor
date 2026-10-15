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

// סכמת object בודדת (Anthropic דורש input_schema מסוג object בשורש; union נדחה).
// mode קובע אילו שדות רלוונטיים; ולידציה סמנטית בהמשך.
export const compareScenariosInput = z.object({
  mode: z.enum(["explicit", "discover"]),
  // explicit:
  candidates: z.array(candidate).optional(),
  // discover:
  includeWaiver: z.boolean().optional(),
  // משותף:
  minNetDelta: z.number().optional(),
});
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
    if (!input.candidates || input.candidates.length === 0) {
      return missing(["candidates"], "להשוואה מפורשת נדרשת רשימת חלופות");
    }
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

  // --- תמצית למודל (לא הפלט המלא). התוצאה המלאה שמורה במסד לפי compareRunId. ---
  // explicit: מחזירים את כל החלופות שהתבקשו. discover: מתחילים ב-5 מובילות.
  const topN = input.mode === "discover" ? 5 : result.comparisons.length;
  const shown = result.comparisons.slice(0, topN);
  const summary = {
    compareRunId: result.compareRunId,
    factsRevision: result.factsRevision,
    ruleSetHash: result.ruleSetHash,
    fresh: true, // נבנתה כעת מול תמונת קלט עקבית
    ranking: "net_delta_desc",
    mode: input.mode,
    currentNet: result.baseline.net, // נטו נוכחי - פעם אחת
    alternatives: shown.map((c) => ({
      // מזהה יציב להתייחסות בהמשך (vehicleCode או label לוויתור)
      ref: c.vehicleCode ?? c.label,
      vehicle: c.name,
      route: c.route,
      net: c.net,
      netDelta: c.netDelta,
      // סיבות השינוי המרכזיות (הנחות/שווי שימוש/חשמלי) - תמצית, לא breakdown מלא
      keyReasons: c.result.assumptions.slice(0, 3),
    })),
    counts: {
      requested: result.coverage.requested,
      computed: result.coverage.computed,
      returnedInSummary: shown.length,
      excluded: result.coverage.excluded,
      incomplete: result.coverage.incomplete,
    },
    // הבחנה מפורשת בין הקטגוריות
    excluded: result.excluded.map((e) => ({ ref: e.label, reasons: e.reasons })), // לא מתאים (זכאות)
    incomplete: result.incomplete.map((i) => ({ ref: i.label, missingFields: i.missingFields })), // לא ניתן לחשב
    notInSummary: Math.max(0, result.coverage.computed - shown.length), // חושבו אך לא נכללו בתמצית
    hint: "לפירוט מלא/חלופה שאינה בתמצית/'למה דווקא זה' - קרא readComparison עם compareRunId.",
  };
  const partial = result.coverage.excluded + result.coverage.incomplete > 0;
  return ok(summary, {
    ...(partial
      ? { message: "כיסוי חלקי: חלק מהחלופות נפסלו (לא מתאים) או חסרות נתונים (לא ניתן לחשב); אין להציג כ'הטוב מכל האפשרויות'" }
      : {}),
  });
}