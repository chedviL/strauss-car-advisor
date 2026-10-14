// src/domain/eligibility/engine.ts
// מנוע זכאות דטרמיניסטי. AC-2.4.*, AC-2.5.*, AC-2.6.*.

import type { RuleSet, RouteKind } from "../contracts/types.js";

export interface Occupation {
  code: string;
  name: string;
  group: string; // קבוצת זכאות
  carMandatory: boolean; // רכב חובה - אין ויתור
  waiverAllowed: boolean;
  maintenanceAllowance: number;
}

export interface EligibilityQuery {
  occupation: Occupation;
  route: RouteKind;
  /** קבוצת הרכב הנבחר (למסלול רגיל). */
  targetGroup?: string | undefined;
  qualifyingChildren?: number | undefined;
}

export type EligibilityStatus = "eligible" | "ineligible" | "missing";

export interface EligibilityResult {
  status: EligibilityStatus;
  reasons: string[];
}

function groupRank(rules: RuleSet, group: string): number {
  return rules.groupOrder.indexOf(group);
}

export function validateEligibility(
  q: EligibilityQuery,
  rules: RuleSet,
): EligibilityResult {
  const reasons: string[] = [];

  if (q.route === "waiver") {
    if (q.occupation.carMandatory) {
      return { status: "ineligible", reasons: ["רכב חובה בעיסוק זה - לא ניתן לוותר"] };
    }
    if (!q.occupation.waiverAllowed) {
      return { status: "ineligible", reasons: ["העיסוק אינו מאפשר ויתור"] };
    }
    return { status: "eligible", reasons: ["העיסוק מאפשר ויתור"] };
  }

  if (q.route === "family") {
    const children = q.qualifyingChildren;
    if (children === undefined) {
      return { status: "missing", reasons: ["חסר מספר ילדים העומדים בקריטריון"] };
    }
    if (children < rules.familyTrack.minChildren) {
      return {
        status: "ineligible",
        reasons: [`מסלול משפחתי דורש ${rules.familyTrack.minChildren} ילדים ומעלה`],
      };
    }
    return { status: "eligible", reasons: ["זכאי למסלול ברוכת ילדים"] };
  }

  // מסלול רגיל: בחירה מקבוצת הזכאות או נמוכה ממנה.
  if (q.targetGroup === undefined) {
    return { status: "missing", reasons: ["חסרה קבוצת הרכב הנבחר"] };
  }
  const empRank = groupRank(rules, q.occupation.group);
  const targetRank = groupRank(rules, q.targetGroup);
  if (empRank < 0 || targetRank < 0) {
    return { status: "missing", reasons: ["קבוצה לא מזוהה"] };
  }
  if (targetRank > empRank) {
    return {
      status: "ineligible",
      reasons: [`הרכב בקבוצה ${q.targetGroup} גבוהה מקבוצת הזכאות ${q.occupation.group}`],
    };
  }
  reasons.push("הרכב מהקבוצה שלך או נמוכה ממנה");
  return { status: "eligible", reasons };
}