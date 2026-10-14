// src/server/repositories/value-of-use-import.ts
// יבוא מאגר שווי השימוש (windows-1255) עם מפתח בן 5 חלקים.
// AC-1.2.1..1.2.5, AC-2.1.1, AC-2.1.2, AC-2.1.9.

import { readFileSync } from "node:fs";

export interface ValueOfUseRow {
  taxYear: string;
  registrationYear: string;
  vehicleTypeCode: string; // קוד סוג רכב (עמודה 2)
  manufacturerCode: string; // קוד תוצר (עמודה 3)
  manufacturerName: string;
  modelCode: string; // קוד דגם (עמודה 5)
  modelDescription: string; // תאור דגם (עמודה 6)
  fuelText: string;
  commercialName: string; // כינוי מסחרי (עמודה 8)
  valueOfUse: string; // שווי שימוש (עמודה 18), כמחרוזת
}

export interface ValueOfUseIndex {
  rowCount: number;
  /** מפתח: "taxYear|regYear|typeCode|mfrCode|modelCode" → רשומה. */
  byKey: Map<string, ValueOfUseRow>;
  /** אינדקס עזר למיפוי קטלוג: "mfrCode|modelCode|regYear" → רשומות (לזיהוי עמימות). */
  byMfrModelYear: Map<string, ValueOfUseRow[]>;
  duplicates: string[];
}

const COL = {
  taxYear: 0, regYear: 1, vehicleTypeCode: 2, manufacturerCode: 3,
  manufacturerName: 4, modelCode: 5, modelDescription: 6, fuelText: 7,
  commercialName: 8, valueOfUse: 18,
} as const;

export function fullKey(r: {
  taxYear: string; registrationYear: string; vehicleTypeCode: string;
  manufacturerCode: string; modelCode: string;
}): string {
  return [
    r.taxYear, r.registrationYear, r.vehicleTypeCode,
    r.manufacturerCode, r.modelCode,
  ].join("|");
}

export function parseValueOfUseCsv(bytes: Uint8Array): ValueOfUseIndex {
  const text = new TextDecoder("windows-1255").decode(bytes);
  const lines = text.split(/\r\n|\n/);
  const byKey = new Map<string, ValueOfUseRow>();
  const byMfrModelYear = new Map<string, ValueOfUseRow[]>();
  const duplicates: string[] = [];
  let rowCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === "") continue;
    const f = line.split(",");
    if (f.length <= COL.valueOfUse) continue;
    const row: ValueOfUseRow = {
      taxYear: (f[COL.taxYear] ?? "").trim(),
      registrationYear: (f[COL.regYear] ?? "").trim(),
      vehicleTypeCode: (f[COL.vehicleTypeCode] ?? "").trim(),
      manufacturerCode: (f[COL.manufacturerCode] ?? "").trim(),
      manufacturerName: (f[COL.manufacturerName] ?? "").trim(),
      modelCode: (f[COL.modelCode] ?? "").trim(),
      modelDescription: (f[COL.modelDescription] ?? "").trim(),
      fuelText: (f[COL.fuelText] ?? "").trim(),
      commercialName: (f[COL.commercialName] ?? "").trim(),
      valueOfUse: (f[COL.valueOfUse] ?? "").trim(),
    };
    rowCount++;

    const key = fullKey(row);
    if (byKey.has(key)) {
      // AC-1.2.4: כפילות מפתח - חוסמים, לא בוחרים "ראשונה".
      duplicates.push(key);
    } else {
      byKey.set(key, row);
    }

    const mmy = [row.manufacturerCode, row.modelCode, row.registrationYear].join("|");
    const arr = byMfrModelYear.get(mmy);
    if (arr) arr.push(row);
    else byMfrModelYear.set(mmy, [row]);
  }

  return { rowCount, byKey, byMfrModelYear, duplicates };
}

export function loadValueOfUseIndex(csvPath: string): ValueOfUseIndex {
  return parseValueOfUseCsv(readFileSync(csvPath));
}

/** שליפת שווי שימוש לפי מפתח 5 חלקים מדויק. ללא קוד סוג רכב - דחייה. */
export function lookupValueOfUse(
  index: ValueOfUseIndex,
  key: {
    taxYear: string; registrationYear: string; vehicleTypeCode: string;
    manufacturerCode: string; modelCode: string;
  },
): { status: "found"; value: string } | { status: "missing_key_part"; missing: string } | { status: "not_found" } {
  for (const [name, val] of Object.entries(key)) {
    if (!val || val.trim() === "") {
      return { status: "missing_key_part", missing: name };
    }
  }
  const row = index.byKey.get(fullKey(key));
  if (!row) return { status: "not_found" };
  return { status: "found", value: row.valueOfUse };
}