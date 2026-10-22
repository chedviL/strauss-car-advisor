// tests/services/payslip-extract-errors.test.ts
// סיווג שגיאות חילוץ ללא קריאת מודל: זיהוי כשל מכסה/קצב (429/RESOURCE_EXHAUSTED)
// כולל עטיפת AI_RetryError של ה-SDK, מול כשל פענוח רגיל. מוודא שהודעת המכסה
// לא מיוחסת בטעות לאיכות הקובץ.
import { describe, it, expect } from "vitest";
import { isQuotaError, PayslipQuotaError, quotaDetails, isTimeoutError, PayslipTimeoutError } from "../../src/server/agent/payslip-extract.js";

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

  it("PayslipQuotaError הוא שם מובחן לטיפול ב-route, ונושא פרטי מכסה", () => {
    const e = new PayslipQuotaError({ metric: "generate_content_free_tier_requests", retryAfterSeconds: 27, raw: "quota" });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("PayslipQuotaError");
    expect(e.details.metric).toContain("free_tier");
    expect(e.details.retryAfterSeconds).toBe(27);
  });
});

describe("חילוץ פרטי מכסה (ללא מודל): metric + זמן המתנה", () => {
  it("מחלץ את שם המכסה (metric) ואת retryDelay בשניות", () => {
    // דמוי גוף שגיאה של Google: metric + RetryInfo.
    const inner = Object.assign(new Error("Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit 0"), {
      responseBody: '{"error":{"code":429,"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"27s"}]}}',
    });
    const wrapped = Object.assign(new Error("Failed after 3 attempts"), { cause: inner });
    const d = quotaDetails(wrapped);
    expect(d.metric).toContain("generate_content_free_tier_requests");
    expect(d.retryAfterSeconds).toBe(27);
  });

  it("מחזיר null לשדות כשאין פרטים, בלי לזרוק", () => {
    const d = quotaDetails(new Error("RESOURCE_EXHAUSTED"));
    expect(d.retryAfterSeconds).toBeNull();
    expect(typeof d.raw).toBe("string");
  });

  it("מסנן ערכי key מהתיעוד (raw)", () => {
    const d = quotaDetails(new Error("boom key=sk-secret-123 quota"));
    expect(d.raw).not.toContain("sk-secret-123");
    expect(d.raw).toContain("key=***");
  });
});

describe("PayslipTimeoutError + isTimeoutError (רגרסיה #timeout-fix)", () => {
  // ראיה: Gemini לוקח 60–110s; maxDuration=60 גרם ל-Vercel להרוג את הפונקציה
  // ולקוח ראה "שגיאת רשת בחילוץ" (fetch throw) במקום הודעה ברורה.
  // התיקון: AbortSignal.timeout(105s) + PayslipTimeoutError → 504 ברור.
  it("isTimeoutError מזהה TimeoutError לפי שם", () => {
    const e = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    expect(isTimeoutError(e)).toBe(true);
  });
  it("isTimeoutError מזהה AbortError לפי שם", () => {
    const e = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    expect(isTimeoutError(e)).toBe(true);
  });
  it("isTimeoutError מזהה AbortError מקונן ב-cause", () => {
    const inner = Object.assign(new Error("aborted"), { name: "AbortError" });
    const wrapper = Object.assign(new Error("AI SDK wrapped"), { name: "AI_APICallError", cause: inner });
    expect(isTimeoutError(wrapper)).toBe(true);
  });
  it("isTimeoutError אינו מסווג שגיאת 429 כ-timeout", () => {
    expect(isTimeoutError(Object.assign(new Error("quota"), { statusCode: 429 }))).toBe(false);
  });
  it("PayslipTimeoutError הוא שם מובחן לטיפול ב-route", () => {
    const e = new PayslipTimeoutError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("PayslipTimeoutError");
  });
});
