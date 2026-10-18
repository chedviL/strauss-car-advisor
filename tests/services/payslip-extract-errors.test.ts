// tests/services/payslip-extract-errors.test.ts
// סיווג שגיאות חילוץ ללא קריאת מודל: זיהוי כשל מכסה/קצב (429/RESOURCE_EXHAUSTED)
// כולל עטיפת AI_RetryError של ה-SDK, מול כשל פענוח רגיל. מוודא שהודעת המכסה
// לא מיוחסת בטעות לאיכות הקובץ.
import { describe, it, expect } from "vitest";
import { isQuotaError, PayslipQuotaError } from "../../src/server/agent/payslip-extract.js";

describe("סיווג כשל חילוץ (ללא מודל)", () => {
  it("מזהה 429 לפי statusCode על גבי שרשרת cause", () => {
    const inner = Object.assign(new Error("API call failed"), { statusCode: 429 });
    const wrapped = Object.assign(new Error("Failed after 3 attempts"), { cause: inner });
    expect(isQuotaError(wrapped)).toBe(true);
  });

  it("מזהה RESOURCE_EXHAUSTED/quota לפי טקסט ההודעה (כולל AI_RetryError)", () => {
    const e = new Error("AI_RetryError: Failed after 3 attempts. Last error: You exceeded your current quota");
    expect(isQuotaError(e)).toBe(true);
    const e2 = new Error("RESOURCE_EXHAUSTED: generate_content_free_tier_requests");
    expect(isQuotaError(e2)).toBe(true);
  });

  it("אינו מסווג כמכסה כשל פענוח/ולידציה רגיל", () => {
    const e = new Error("No object generated: response did not match schema");
    expect(isQuotaError(e)).toBe(false);
    const e2 = new Error("Unexpected token < in JSON");
    expect(isQuotaError(e2)).toBe(false);
  });

  it("PayslipQuotaError הוא שם מובחן לטיפול ב-route", () => {
    const e = new PayslipQuotaError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("PayslipQuotaError");
  });
});