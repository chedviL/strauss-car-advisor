// tests/services/rep-input.test.ts
// בדיקות טהורות (בלי מסד/מודל): אימות קלט מענה נציג, נתיב חזרה אחרי התחברות,
// דגל ההדגמה, ועזרי התצוגה של מסך הנציג (הבחנה בין ערך חסר לאפס מפורש; הודעות תוצאה).
import { describe, it, expect } from "vitest";
import { parseRepAnswer, isUuid, MAX_NOTE_LENGTH } from "../../src/server/auth/rep-input.js";
import { safeReturnPath } from "../../src/server/auth/return-path.js";
import { repDemoEnabled } from "../../src/server/auth/demo-rep.js";
import {
  parseValueInput, describeValueInput, describeAnswerResult, summarize, DEMO_NOTICE,
} from "../../src/features/representative/rep-format.js";

describe("parseRepAnswer: קלט מהלקוח אינו מהימן", () => {
  it("אפס מפורש נשמר כ-0 ואינו הופך ל-null (חסר)", () => {
    const r = parseRepAnswer({ value: 0, note: null, effectiveFrom: null });
    expect(r).toEqual({ ok: true, answer: { value: 0, note: null, effectiveFrom: null } });
    const missing = parseRepAnswer({ value: null, note: "הערה", effectiveFrom: null });
    expect(missing.ok && missing.answer.value).toBeNull();
  });

  it("דוחה NaN, אינסוף, שלילי, חריגה, וסוגים שגויים", () => {
    for (const bad of [Number.NaN, Infinity, -1, 100_001, "300", {}, true]) {
      expect(parseRepAnswer({ value: bad, note: null, effectiveFrom: null }).ok).toBe(false);
    }
  });

  it("מנרמל הערה (trim, ריק -> null) ומגביל אורך", () => {
    const r = parseRepAnswer({ value: 1, note: "  שלום  ", effectiveFrom: null });
    expect(r.ok && r.answer.note).toBe("שלום");
    const empty = parseRepAnswer({ value: 1, note: "   ", effectiveFrom: null });
    expect(empty.ok && empty.answer.note).toBeNull();
    expect(parseRepAnswer({ value: 1, note: "x".repeat(MAX_NOTE_LENGTH + 1), effectiveFrom: null }).ok).toBe(false);
  });

  it("תאריך תחולה: רק תאריך אמיתי בפורמט ISO", () => {
    expect(parseRepAnswer({ value: 1, note: null, effectiveFrom: "2026-03-01" }).ok).toBe(true);
    for (const bad of ["2026-02-30", "01/03/2026", "2026-3-1", "never", 20260301, "1999-01-01"]) {
      expect(parseRepAnswer({ value: 1, note: null, effectiveFrom: bad }).ok).toBe(false);
    }
  });

  it("דוחה גוף שאינו אובייקט; מזהה פנייה חייב להיות uuid", () => {
    expect(parseRepAnswer(null).ok).toBe(false);
    expect(parseRepAnswer("x").ok).toBe(false);
    expect(isUuid("00000000-0000-4000-8000-000000000000")).toBe(true);
    expect(isUuid("1; drop table inquiries")).toBe(false);
  });
});

describe("safeReturnPath: רשימת היתרים סגורה (בלי redirect פתוח)", () => {
  const id = "0b9d3f5e-8c1a-4f6e-9a77-1c2d3e4f5a6b";
  it("מאשר קישור התראה ומסך נציג", () => {
    expect(safeReturnPath(`/go/case/${id}`)).toBe(`/go/case/${id}`);
    expect(safeReturnPath("/representative")).toBe("/representative");
    expect(safeReturnPath(`/go/case/${id}?x=1`)).toBe(`/go/case/${id}`);
  });
  it("דוחה כתובות חיצוניות, פרוטוקולים, נתיבים אחרים וקלט פגום", () => {
    for (const bad of [
      "https://evil.example/", "//evil.example", "/\\evil", "/api/chat", "/go/case/not-a-uuid",
      "/go/case/" + id + "/../../x", "javascript:alert(1)", "", null, undefined, "/go/case/" + id + "\r\nSet-Cookie: a=b",
    ]) {
      expect(safeReturnPath(bad as string | null | undefined)).toBeNull();
    }
  });
});

describe("repDemoEnabled: ברירת מחדל פעיל", () => {
  it("חסר/ריק/ערך לא מוכר = פעיל; 0/false/off = כבוי", () => {
    expect(repDemoEnabled({})).toBe(true);
    expect(repDemoEnabled({ REP_DEMO_ACCESS_ENABLED: "" })).toBe(true);
    expect(repDemoEnabled({ REP_DEMO_ACCESS_ENABLED: "yes please" })).toBe(true);
    expect(repDemoEnabled({ REP_DEMO_ACCESS_ENABLED: "1" })).toBe(true);
    expect(repDemoEnabled({ REP_DEMO_ACCESS_ENABLED: " TRUE " })).toBe(true);
    expect(repDemoEnabled({ REP_DEMO_ACCESS_ENABLED: "0" })).toBe(false);
    expect(repDemoEnabled({ REP_DEMO_ACCESS_ENABLED: "false" })).toBe(false);
    expect(repDemoEnabled({ REP_DEMO_ACCESS_ENABLED: "off" })).toBe(false);
  });
});

describe("עזרי תצוגה של מסך הנציג", () => {
  it("ערך חסר שונה מאפס מפורש", () => {
    expect(parseValueInput("")).toEqual({ kind: "missing" });
    expect(parseValueInput("  ")).toEqual({ kind: "missing" });
    expect(parseValueInput("0")).toEqual({ kind: "value", value: 0 });
    expect(describeValueInput(parseValueInput(""))).toContain("הערה בלבד");
    expect(describeValueInput(parseValueInput("0"))).toContain("אפס מפורש");
    expect(parseValueInput("-5").kind).toBe("invalid");
    expect(parseValueInput("abc").kind).toBe("invalid");
  });

  it("'ההשוואה חושבה מחדש' רק כשחושבה בפועל", () => {
    const applied = describeAnswerResult({ status: "applied", recomputed: true });
    expect(applied.tone).toBe("ok");
    expect(applied.title).toContain("חושבה מחדש");
    for (const res of [
      { status: "applied", recomputed: false, missingFields: ["baseSalary"] },
      { status: "applied", recomputed: false },
      { status: "stale_context" },
      { status: "future_effective", effectiveFrom: "2999-01-01" },
      { status: "recorded_not_applied", reason: "no_value" },
    ]) {
      const m = describeAnswerResult(res);
      expect(m.tone).toBe("warn");
      expect(m.title).not.toMatch(/וההשוואה חושבה מחדש\.$/);
    }
  });

  it("הקשר מיושן ותחולה עתידית מציגים סיבה ודרך המשך", () => {
    const stale = describeAnswerResult({ status: "stale_context" });
    expect(stale.title).toContain("לא הוחלה");
    expect(stale.detail).toContain("בירור מחדש");
    const future = describeAnswerResult({ status: "future_effective", effectiveFrom: "2999-01-01" });
    expect(future.title).toContain("עתידית");
    expect(future.detail).toContain("להחלה מיידית");
  });

  it("שגיאות מציינות שהטופס נשמר", () => {
    expect(describeAnswerResult({ status: "error", message: "שגיאה" }).detail).toContain("הטופס נשמר");
    expect(describeAnswerResult({ status: "invalid", message: "x" }).tone).toBe("err");
  });

  it("תקציר ענייני ושם רכב מהקטלוג; נוסח ההתנסות מדויק", () => {
    expect(summarize({ type: "employee_participation", scenarioRole: "alternative", route: "company_car", vehicleCode: "CAR-10" }, { "CAR-10": "ATTO 3" }))
      .toBe("החלופה הנבחנת: ATTO 3 · רכב חברה");
    expect(DEMO_NOTICE).toBe(
      "התנסות בתפקיד נציג — הגישה מוגבלת לפניות הבדיקה שלך ולנתונים פיקטיביים. במערכת ארגונית הגישה מיועדת לנציגים מורשים.",
    );
  });
});
