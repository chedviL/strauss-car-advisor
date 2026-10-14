// tests/import/catalog-conformance.test.ts
// RT-1/RT-2/RT-3 + התאמת כל 20 רכבי הקטלוג למאגר.
// AC-1.2.*, AC-2.1.*. בדיקות רגרסיה חוזרות על הקובץ האמיתי (windows-1255).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import {
  parseValueOfUseCsv,
  lookupValueOfUse,
  type ValueOfUseIndex,
} from "../../src/server/repositories/value-of-use-import.js";
import {
  importCatalog,
  resolveVehicle,
  verifyResolvedKey,
} from "../../src/server/repositories/catalog-import.js";
import { CATALOG } from "../../data/source/catalog.js";

const here = dirname(fileURLToPath(import.meta.url));
const csvPath = join(here, "../../data/source/value-of-use-2026.csv");

let index: ValueOfUseIndex;

beforeAll(() => {
  index = parseValueOfUseCsv(readFileSync(csvPath));
});

describe("יבוא CSV שווי שימוש", () => {
  it("מספר רשומות = 77,988 (AC-1.2.1)", () => {
    expect(index.rowCount).toBe(77988);
  });
  it("אין כפילויות מפתח 5 חלקים (AC-1.2.4)", () => {
    expect(index.duplicates).toHaveLength(0);
  });
});

describe("RT-1: חד-משמעיות מפתח 5 חלקים (ATTO 3 מול TANG)", () => {
  it("קוד סוג 1 = ATTO 3 → 3130", () => {
    const r = lookupValueOfUse(index, {
      taxYear: "2026", registrationYear: "2025", vehicleTypeCode: "1",
      manufacturerCode: "01014", modelCode: "00003",
    });
    expect(r.status).toBe("found");
    if (r.status === "found") expect(r.value).toBe("3130");
  });
  it("קוד סוג 2 = TANG → 6950", () => {
    const r = lookupValueOfUse(index, {
      taxYear: "2026", registrationYear: "2025", vehicleTypeCode: "2",
      manufacturerCode: "01014", modelCode: "00003",
    });
    expect(r.status).toBe("found");
    if (r.status === "found") expect(r.value).toBe("6950");
  });
  it("שליפה ללא קוד סוג רכב נדחית (AC-2.1.2)", () => {
    const r = lookupValueOfUse(index, {
      taxYear: "2026", registrationYear: "2025", vehicleTypeCode: "",
      manufacturerCode: "01014", modelCode: "00003",
    });
    expect(r.status).toBe("missing_key_part");
  });
});

describe("RT-2: הכרעת קוד סוג רכב בקטלוג עם provenance", () => {
  it("CAR-10 (ATTO 3) מוכרע לקוד סוג 1 לפי תאור דגם + כינוי, לא לפי סכום", () => {
    const car = CATALOG.find((c) => c.id === "CAR-10")!;
    const r = resolveVehicle(car, index);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.vehicle.vehicleTypeCode).toBe("1");
      expect(r.vehicle.valueOfUse).toBe("3130");
      expect(r.vehicle.typeResolutionSource).toContain("תאור דגם");
    }
  });
});

describe("RT-3: הנעה לפי קטלוג + JSON (לא לפי כותרת CSV מטעה)", () => {
  it("רכבים חשמליים מקבלים propulsion=3", () => {
    const { resolved } = importCatalog(CATALOG, index);
    const atto = resolved.find((v) => v.id === "CAR-10")!;
    expect(atto.propulsion).toBe(3);
    const corolla = resolved.find((v) => v.id === "CAR-09")!;
    expect(corolla.propulsion).toBe(1); // היברידי
  });
});

describe("התאמת כל 20 רכבי הקטלוג", () => {
  it("כל הרכבים נפתרים ללא חסימה, והמפתח המדויק מאשר את השווי", () => {
    const { resolved, blocked } = importCatalog(CATALOG, index);
    expect(blocked, JSON.stringify(blocked)).toHaveLength(0);
    expect(resolved).toHaveLength(20);
    for (const v of resolved) {
      expect(verifyResolvedKey(v, index), `${v.id} key verify`).toBe(true);
    }
  });

  it("שווי השימוש שהוכרע תואם לערך בקטלוג (אימות עקיף)", () => {
    const { resolved } = importCatalog(CATALOG, index);
    for (const v of resolved) {
      const cat = CATALOG.find((c) => c.id === v.id)!;
      expect(Number(v.valueOfUse), `${v.id}`).toBe(cat.catalogValueOfUse);
    }
  });
});