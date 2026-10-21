// tests/engine/eligibility-family.test.ts
// רגרסיה: מסלול משפחתי חייב רכב משפחתי; רכב משפחתי אינו נבחר במסלול רגיל;
// מספר ילדים לא ידוע = "חסר" (לא זכאות).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { validateEligibility } from "../../src/domain/eligibility/engine.js";
import { parseRules } from "../../src/domain/calculation/rule-set-loader.js";
import { findOccupation } from "../../data/source/occupations.js";

const here = dirname(fileURLToPath(import.meta.url));
const { rules } = parseRules(readFileSync(join(here, "../../data/source/strauss-rules.json"), "utf8"));
const dev = findOccupation("developer")!; // קבוצה ב'

describe("מסלול משפחתי: זכאות לפי רכב", () => {
  it("4 ילדים + רכב משפחתי (CAR-19) -> זכאי", () => {
    const r = validateEligibility({ occupation: dev, route: "family", qualifyingChildren: 4, vehicle: { code: "CAR-19", group: "משפחתי" } }, rules);
    expect(r.status).toBe("eligible");
  });
  it("4 ילדים + רכב רגיל (TUCSON) במסלול משפחתי -> לא זכאי", () => {
    const r = validateEligibility({ occupation: dev, route: "family", qualifyingChildren: 4, vehicle: { code: "CAR-12", group: "ג" } }, rules);
    expect(r.status).toBe("ineligible");
  });
  it("מספר ילדים לא ידוע -> חסר (לא זכאי)", () => {
    expect(validateEligibility({ occupation: dev, route: "family", vehicle: { code: "CAR-19", group: "משפחתי" } }, rules).status).toBe("missing");
    expect(validateEligibility({ occupation: dev, route: "family", qualifyingChildren: NaN }, rules).status).toBe("missing");
  });
  it("רכב משפחתי במסלול רגיל -> לא זכאי (היה 'חסר' ונכנס לחישוב ללא פער משפחתי)", () => {
    const viaGroup = validateEligibility({ occupation: dev, route: "company_car", targetGroup: "משפחתי" }, rules);
    expect(viaGroup.status).toBe("ineligible");
    const viaVehicle = validateEligibility({ occupation: dev, route: "company_car", targetGroup: "ב", vehicle: { code: "CAR-20", group: "משפחתי" } }, rules);
    expect(viaVehicle.status).toBe("ineligible");
  });
  it("רכב רגיל מקבוצה נמוכה במסלול רגיל נשאר זכאי", () => {
    const r = validateEligibility({ occupation: dev, route: "company_car", targetGroup: "א", vehicle: { code: "CAR-01", group: "א" } }, rules);
    expect(r.status).toBe("eligible");
  });
});
