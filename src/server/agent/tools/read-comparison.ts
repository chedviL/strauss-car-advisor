// src/server/agent/tools/read-comparison.ts
// פירוט לפי דרישה מתוך תוצאת השוואה שמורה (compareRunId), בלי חישוב מחדש:
// "למה דווקא זה?", "מה במקום השישי?", "תראה את כולן", חלופה שאינה בתמצית.
// שולף מהמסד; אם הנתונים/הכללים השתנו מאז - מסמן כלא-עדכני.

import { z } from "zod";
import type { CaseService } from "../../services/case-service.js";
import type { ToolContext, ToolResult } from "../tool-contracts.js";
import { ok, missing } from "../tool-contracts.js";

export const readComparisonInput = z.object({
  compareRunId: z.string().min(1),
  // ברירת מחדל: כל החלופות שחושבו. אפשר טווח דירוג או ref ספציפי.
  ref: z.string().min(1).optional(),          // vehicleCode/label ספציפי לפירוט מלא
  fromRank: z.number().int().min(1).optional(), // טווח דירוג (1-based)
  toRank: z.number().int().min(1).optional(),
});
export type ReadComparisonInput = z.infer<typeof readComparisonInput>;

interface SavedRow {
  label: string; route: string; vehicleCode: string | null;
  net: number; netDelta: number; result: { breakdown: unknown; assumptions: string[]; netDisplay: string };
}
interface SavedResult {
  baseline: { net: number };
  comparisons: SavedRow[];
  coverage: { requested: number; computed: number; excluded: number; incomplete: number };
}

export async function readComparison(
  service: CaseService,
  ctx: ToolContext,
  input: ReadComparisonInput,
): Promise<ToolResult<unknown>> {
  const run = await service.loadCompareRun(ctx.caseId, ctx.ownerId, input.compareRunId);
  if (!run) return missing(["compareRunId"], "לא נמצאה השוואה שמורה בזיהוי זה");

  // עדכניות: אם גרסת העובדות השתנתה מאז, מסמנים.
  const state = await service.getCaseState(ctx.caseId, ctx.ownerId);
  const stale = !!state && state.case.factsRevision !== run.factsRevision;

  const result = run.result as SavedResult;
  const rows = result.comparisons;

  // פירוט חלופה ספציפית (ref)
  if (input.ref) {
    const row = rows.find((r) => (r.vehicleCode ?? r.label) === input.ref);
    if (!row) return missing(["ref"], `החלופה '${input.ref}' אינה בתוצאה השמורה`);
    return ok(
      {
        compareRunId: run.id, stale,
        ref: row.vehicleCode ?? row.label, route: row.route,
        net: row.net, netDelta: row.netDelta,
        breakdown: row.result.breakdown, // פירוט מלא לחלופה המבוקשת בלבד
        assumptions: row.result.assumptions,
      },
      stale ? { message: "התוצאה מיושנת: העובדות השתנו מאז החישוב. שקול/י חישוב מחדש." } : {},
    );
  }

  // טווח דירוג (או הכל). ברירת מחדל: הכל.
  const from = (input.fromRank ?? 1) - 1;
  const to = input.toRank ?? rows.length;
  const slice = rows.slice(from, to).map((r, i) => ({
    rank: from + i + 1,
    ref: r.vehicleCode ?? r.label, route: r.route,
    net: r.net, netDelta: r.netDelta,
    assumptions: r.result.assumptions.slice(0, 3),
  }));
  return ok(
    {
      compareRunId: run.id, stale, currentNet: result.baseline.net,
      ranking: run.ranking, total: rows.length, returned: slice.length,
      alternatives: slice,
      coverage: result.coverage,
    },
    stale ? { message: "התוצאה מיושנת: העובדות השתנו מאז החישוב. שקול/י חישוב מחדש." } : {},
  );
}