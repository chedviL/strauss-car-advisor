// src/server/services/vehicle-match-service.ts
// תזמור "איזה רכב מתאים לי?" בצד שרת: זכאות (מנוע קיים) + מפרטים מאושרים + נטו (מנוע קיים).
// קריאה בלבד מבחינת הרכב/השוואה: אינו פותח בירור, אינו משנה baseline ואינו כותב חלופה.
// הכתיבה היחידה האפשרית: קבוצת זכאות שהעובד/ת מסר/ה במפורש בשלב הסיום, דרך שירות העובדות הקיים.

import { findOccupation } from "../../../data/source/occupations.js";
import { SPEC_SOURCES, VEHICLE_SPECS } from "../../../data/source/vehicle-specs.js";
import { makeEligibilityCheck, resolveOccupation } from "../../domain/vehicle-match/eligibility.js";
import { matchVehicles } from "../../domain/vehicle-match/engine.js";
import { matchRequestSchema } from "../../domain/vehicle-match/schema.js";
import type { CompleteAnswers, MatchResult } from "../../domain/vehicle-match/types.js";
import type { CaseState } from "../../domain/contracts/case.js";
import type { CaseService } from "./case-service.js";

export type VehicleMatchResponse =
  | {
      status: "ok";
      result: MatchResult;
      /** מקור קבוצת הזכאות ששימשה את ההתאמה. */
      groupSource: "occupation" | "reported" | "override" | null;
      groupSaved: boolean;
      hasCase: boolean;
    }
  | { status: "invalid" };

export async function executeVehicleMatch(
  service: CaseService,
  ownerId: string,
  raw: unknown,
): Promise<VehicleMatchResponse> {
  const parsed = matchRequestSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid" };
  const { caseId, groupOverride, saveGroup } = parsed.data;
  const answers = parsed.data.answers as CompleteAnswers;

  // בעלות נאכפת ב-repository: תיק של אחר = null (כאילו אין תיק).
  let state: CaseState | null = caseId ? await service.getCaseState(caseId, ownerId) : null;
  const { catalog, rules } = await service.matchDataset();

  let resolved = resolveOccupation(state?.facts ?? { occupationCode: null, reportedGroup: null }, findOccupation, groupOverride);
  let groupSaved = false;

  if (state && resolved.source === "override" && saveGroup && groupOverride) {
    try {
      let res = await service.updateFacts(state.case.id, ownerId, { reportedGroup: groupOverride }, state.case.factsRevision);
      if (res.status === "conflict") {
        const fresh = await service.getCaseState(state.case.id, ownerId);
        if (fresh && !fresh.facts.reportedGroup && !findOccupation(fresh.facts.occupationCode)) {
          res = await service.updateFacts(fresh.case.id, ownerId, { reportedGroup: groupOverride }, fresh.case.factsRevision);
        }
      }
      if (res.status !== "conflict") {
        groupSaved = true;
        state = await service.getCaseState(state.case.id, ownerId);
        resolved = resolveOccupation(state?.facts ?? { occupationCode: null, reportedGroup: null }, findOccupation, groupOverride);
      }
    } catch {
      // לא מצליחים לשמור - ההתאמה ממשיכה עם הקבוצה כפי שנמסרה, ללא שמירה.
    }
  }

  // נטו: רק עם תיק קיים. אם הקבוצה נמסרה רק בשאלון ולא נשמרה - משתמשים בה בזיכרון בלבד לתצוגה.
  let net = null;
  if (state) {
    const facts = resolved.source === "override" && !state.facts.reportedGroup
      ? { ...state.facts, reportedGroup: groupOverride }
      : state.facts;
    net = await service.previewNetForCatalog(state, facts);
  }

  const result = matchVehicles({
    answers,
    eligibility: { group: resolved.occupation?.group ?? null, qualifyingChildren: state?.facts.qualifyingChildren ?? null },
    eligibilityCheck: makeEligibilityCheck(rules, resolved.occupation, state?.facts.qualifyingChildren ?? null),
    catalog,
    specs: VEHICLE_SPECS,
    sources: SPEC_SOURCES,
    net,
  });

  return { status: "ok", result, groupSource: resolved.source, groupSaved, hasCase: state !== null };
}
