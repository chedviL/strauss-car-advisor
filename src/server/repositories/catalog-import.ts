// src/server/repositories/catalog-import.ts
// יבוא קטלוג הרכבים והכרעת vehicle_type_code לפי התאמת תאור דגם + כינוי מסחרי
// מול ה-CSV (לא לפי התאמת סכום). רישום provenance; חסימת רכב עמום.
// AC-2.1.3, AC-2.1.4, AC-2.1.5, AC-2.1.7, AC-2.1.8, AC-2.1.10, O14.

import type { ValueOfUseIndex, ValueOfUseRow } from "./value-of-use-import.js";
import { fullKey } from "./value-of-use-import.js";

export interface CatalogVehicleRaw {
  id: string;
  group: string; // א/ב/ג/ד/משפחתי
  manufacturerCode: string;
  commercialName: string; // "דגם (כינוי מסחרי)"
  modelCode: string;
  modelDescription: string; // "תאור דגם"
  registrationYear: string;
  propulsionText: string; // "הנעה" מהקטלוג
  listPrice: number;
  catalogValueOfUse: number; // שווי שימוש כפי שמופיע בקטלוג (לאימות בלבד, לא למפתח)
  companyCost: number;
  defaultParticipation: number;
}

export interface ResolvedVehicle {
  id: string;
  group: string;
  manufacturerCode: string;
  modelCode: string;
  registrationYear: string;
  vehicleTypeCode: string;
  valueOfUse: string;
  propulsion: 0 | 1 | 2 | 3;
  companyCost: number;
  defaultParticipation: number;
  typeResolutionSource: string; // provenance - כיצד הוכרע הקוד
}

export interface BlockedVehicle {
  id: string;
  reason: string;
  candidates: Array<{ typeCode: string; commercial: string; modelDesc: string; value: string }>;
}

export interface CatalogImportResult {
  resolved: ResolvedVehicle[];
  blocked: BlockedVehicle[];
}

const TAX_YEAR = "2026"; // שנת המס במאגר שווי השימוש (מקור 2026)

/** מיפוי טקסט ההנעה מהקטלוג לקוד driveField (3=חשמלי). */
function propulsionFromText(text: string): 0 | 1 | 2 | 3 {
  if (text.includes("חשמלי")) return 3;
  if (text.includes("פלאג")) return 2;
  if (text.includes("היבריד")) return 1;
  return 0;
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * הכרעת vehicle_type_code: מבין הרשומות שחולקות mfr+model+regYear,
 * בוחרים את זו שבה תאור הדגם וגם הכינוי המסחרי תואמים לקטלוג.
 * אם יותר מרשומה אחת שורדת, או אף אחת - הרכב נחסם (עמום).
 * התאמת סכום לעולם אינה הבסיס להכרעה.
 */
export function resolveVehicle(
  v: CatalogVehicleRaw,
  index: ValueOfUseIndex,
): { ok: true; vehicle: ResolvedVehicle } | { ok: false; blocked: BlockedVehicle } {
  const mmy = [v.manufacturerCode, v.modelCode, v.registrationYear].join("|");
  const candidates = index.byMfrModelYear.get(mmy) ?? [];

  const candidateView = candidates.map((c) => ({
    typeCode: c.vehicleTypeCode,
    commercial: c.commercialName,
    modelDesc: c.modelDescription,
    value: c.valueOfUse,
  }));

  if (candidates.length === 0) {
    return {
      ok: false,
      blocked: { id: v.id, reason: "לא נמצאה רשומת מקור תואמת (mfr+model+year)", candidates: [] },
    };
  }

  // התאמה לפי תאור דגם + כינוי מסחרי (שדות שאינם סכום).
  const descMatch = (r: ValueOfUseRow): boolean =>
    norm(r.modelDescription) === norm(v.modelDescription) &&
    norm(r.commercialName) === norm(v.commercialName);

  let matches = candidates.filter(descMatch);
  let provenance = "התאמת תאור דגם + כינוי מסחרי";

  // אם רק רשומה אחת ממילא - חד-משמעי (אין עמימות).
  if (candidates.length === 1) {
    matches = candidates;
    provenance = "רשומת מקור יחידה (mfr+model+year)";
  }

  if (matches.length !== 1) {
    return {
      ok: false,
      blocked: {
        id: v.id,
        reason:
          matches.length === 0
            ? "אין התאמת תאור דגם/כינוי מסחרי - עמום, דורש הכרעה מתועדת"
            : "יותר מרשומה אחת תואמת - עמום, דורש הכרעה מתועדת",
        candidates: candidateView,
      },
    };
  }

  const row = matches[0]!;
  return {
    ok: true,
    vehicle: {
      id: v.id,
      group: v.group,
      manufacturerCode: v.manufacturerCode,
      modelCode: v.modelCode,
      registrationYear: v.registrationYear,
      vehicleTypeCode: row.vehicleTypeCode,
      valueOfUse: row.valueOfUse,
      propulsion: propulsionFromText(v.propulsionText),
      companyCost: v.companyCost,
      defaultParticipation: v.defaultParticipation,
      typeResolutionSource: provenance,
    },
  };
}

export function importCatalog(
  vehicles: CatalogVehicleRaw[],
  index: ValueOfUseIndex,
): CatalogImportResult {
  const resolved: ResolvedVehicle[] = [];
  const blocked: BlockedVehicle[] = [];
  for (const v of vehicles) {
    const r = resolveVehicle(v, index);
    if (r.ok) resolved.push(r.vehicle);
    else blocked.push(r.blocked);
  }
  return { resolved, blocked };
}

/** בדיקה שהמפתח המדויק 5-חלקים אכן מצביע על שווי השימוש שהוכרע. */
export function verifyResolvedKey(
  v: ResolvedVehicle,
  index: ValueOfUseIndex,
): boolean {
  const row = index.byKey.get(
    fullKey({
      taxYear: TAX_YEAR,
      registrationYear: v.registrationYear,
      vehicleTypeCode: v.vehicleTypeCode,
      manufacturerCode: v.manufacturerCode,
      modelCode: v.modelCode,
    }),
  );
  return !!row && row.valueOfUse === v.valueOfUse;
}