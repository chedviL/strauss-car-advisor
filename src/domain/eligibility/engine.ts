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
  /** הרכב הנבחר (קוד + קבוצה בקטלוג). במסלול משפחתי חייב להיות רכב משפחתי; במסלול רגיל לא רכב משפחתי. */
  vehicle?: { code: string; group: string } | undefined;
}

const FAMILY_GROUP = "משפחתי";

function isFamilyVehicle(vehicle: { code: string; group: string }, rules: RuleSet): boolean {
  const cars = rules.familyTrack.cars;
  return cars.length > 0 ? cars.includes(vehicle.code) : vehicle.group === FAMILY_GROUP;
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
    if (children === undefined || !Number.isFinite(children)) {
      return { status: "missing", reasons: ["חסר מספר ילדים העומדים בקריטריון"] };
    }
    if (children < rules.familyTrack.minChildren) {
      return {
        status: "ineligible",
        reasons: [`מסלול משפחתי דורש ${rules.familyTrack.minChildren} ילדים ומעלה`],
      };
    }
    if (q.vehicle && !isFamilyVehicle(q.vehicle, rules)) {
      return { status: "ineligible", reasons: ["המסלול המשפחתי זמין רק לרכבי הקבוצה המשפחתית"] };
    }
    return { status: "eligible", reasons: ["זכאי למסלול ברוכת ילדים"] };
  }

  // רכב משפחתי אינו חלק מהמסלול הרגיל (אין לו קבוצת זכאות רגילה): נדרש מסלול משפחתי.
  if (q.targetGroup === FAMILY_GROUP || (q.vehicle && isFamilyVehicle(q.vehicle, rules))) {
    return { status: "ineligible", reasons: ["רכב משפחתי זמין רק במסלול המשפחתי (4 ילדים ומעלה)"] };
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