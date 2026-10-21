// src/domain/vehicle-match/eligibility.ts
// עטיפה דקה סביב מנוע הזכאות הקיים (validateEligibility). אין כאן כלל זכאות חדש.

import { validateEligibility, type Occupation } from "../eligibility/engine.js";
import type { RuleSet } from "../contracts/types.js";
import type { CatalogEntry } from "./types.js";

export interface GroupSource {
  occupationCode: string | null;
  reportedGroup: string | null;
}

/**
 * קביעת העיסוק לבדיקת זכאות: עיסוק מוכר מהטבלה, אחרת קבוצה שדווחה, אחרת קבוצה שנמסרה
 * בשאלון (override). אין ניחוש מתפקיד חופשי: בלי אחד משלושת אלה - null.
 */
export function resolveOccupation(
  src: GroupSource,
  findOccupation: (code: string | null) => Occupation | undefined,
  groupOverride: string | null,
): { occupation: Occupation | null; source: "occupation" | "reported" | "override" | null } {
  const occ = findOccupation(src.occupationCode);
  if (occ) return { occupation: occ, source: "occupation" };
  const synth = (group: string): Occupation =>
    ({ code: "reported", name: "לפי קבוצה שנמסרה", group, carMandatory: false, waiverAllowed: false, maintenanceAllowance: 0 });
  if (src.reportedGroup) return { occupation: synth(src.reportedGroup), source: "reported" };
  if (groupOverride) return { occupation: synth(groupOverride), source: "override" };
  return { occupation: null, source: null };
}

export function makeEligibilityCheck(
  rules: RuleSet,
  occupation: Occupation | null,
  qualifyingChildren: number | null,
): (entry: CatalogEntry) => "eligible" | "ineligible" | "missing" {
  return (entry) => {
    if (!occupation) return "missing";
    const family = entry.group === "משפחתי";
    const res = validateEligibility(
      {
        occupation,
        route: family ? "family" : "company_car",
        targetGroup: family ? undefined : entry.group,
        qualifyingChildren: qualifyingChildren ?? undefined,
        vehicle: { code: entry.id, group: entry.group },
      },
      rules,
    );
    return res.status;
  };
}
