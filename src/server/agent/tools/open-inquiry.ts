// src/server/agent/tools/open-inquiry.ts
// פתיחת פנייה לנציג לנושאים שבתחום אחריותו בלבד. השרת בונה נמען/הקשר.
// dedup: פנייה פתוחה זהה (type + הקשר) מוחזרת כקיימת, בלי כפילות.

import { z } from "zod";
import type { CaseService } from "../../services/case-service.js";
import type { ToolContext, ToolResult } from "../tool-contracts.js";
import { ok, missing } from "../tool-contracts.js";

export const openInquiryInput = z.object({
  // רשימת סוגים סגורה - רק נושאים בתחום אחריות הנציג.
  type: z.enum(["employee_participation", "occupation_eligibility_clarification"]),
  scenarioId: z.string().min(1).nullable().optional(),
});
export type OpenInquiryInput = z.infer<typeof openInquiryInput>;

export async function openInquiry(
  service: CaseService,
  ctx: ToolContext,
  input: OpenInquiryInput,
): Promise<ToolResult<{ inquiryId: string; deduped: boolean }>> {
  const state = await service.getCaseState(ctx.caseId, ctx.ownerId);
  if (!state) return missing(["case"], "התיק לא נמצא");
  const scenarioId = input.scenarioId ?? null;
  const scenario = scenarioId
    ? state.scenarios.find((s) => s.id === scenarioId) ?? null
    : state.scenarios.find((s) => s.role === "alternative") ?? null;

  // ההקשר נבנה בשרת מהתיק (לא מהמודל): סוג, רכב/מסלול, קבוצה, גרסת עובדות.
  const res = await service.openInquiry(ctx.caseId, ctx.ownerId, input.type, scenario?.id ?? null, {
    type: input.type,
    route: scenario?.route ?? "",
    vehicle: scenario?.vehicleCode ?? "",
    group: state.facts.reportedGroup ?? "",
    factsRevision: state.case.factsRevision,
  });
  return ok(
    { inquiryId: res.inquiry.id, deduped: res.deduped },
    { message: res.deduped ? "קיימת כבר פנייה פתוחה זהה; לא נפתחה כפילות" : "נפתחה פנייה לנציג; אפשר להמשיך בבירורים אחרים בינתיים" },
  );
}