// tests/services/notify-content.test.ts
// תוכן מיילי ההתראה (ללא DB וללא מודל): נוסח נכון לכל סוג, ללא פרטים כספיים,
// וקישור מאובטח שעובר דרך שער בעלות. ווידוא מפורש: answer_recorded אינו טוען
// "ההשוואה מוכנה".
import { describe, it, expect } from "vitest";
import { buildContent, caseLink } from "../../src/server/notify/content.js";

describe("תוכן התראות מייל", () => {
  const link = caseLink("https://app.example.com", "11111111-1111-1111-1111-111111111111");

  it("caseLink עובר דרך שער הבעלות /go/case ומכיל את מזהה התיק", () => {
    expect(link).toBe("https://app.example.com/go/case/11111111-1111-1111-1111-111111111111");
  });

  it("קישור תשובת נציג כולל מזהה inquiry לקפיצה לתשובה, מקודד URL", () => {
    expect(caseLink("https://app.example.com", "case-id", "inquiry id"))
      .toBe("https://app.example.com/go/case/case-id?answer=inquiry%20id");
  });

  it("comparison_ready: מודיע על עדכון ההשוואה, עם קישור", () => {
    const c = buildContent("comparison_ready", link);
    expect(c.subject).toContain("ההשוואה");
    expect(c.html).toContain(link);
    expect(c.text).toContain(link);
  });

  it("answer_recorded: *אינו* טוען שההשוואה מוכנה", () => {
    const c = buildContent("answer_recorded", link);
    const all = c.subject + " " + c.text + " " + c.html;
    expect(all).not.toContain("ההשוואה מוכנה");
    expect(all).not.toContain("מוכנה");
    expect(c.text).toContain(link);
  });

  it("אין פרטים כספיים: שום סכום/₪/נטו/שכר בשום סוג התראה", () => {
    for (const kind of ["comparison_ready", "answer_recorded"] as const) {
      const c = buildContent(kind, link);
      const body = c.subject + " " + c.text + " " + c.html;
      expect(body).not.toContain("₪");
      for (const w of ["שכר", "נטו", "ברוטו", "סכום", "משכורת"]) expect(body).not.toContain(w);
      // אין רצף ספרות שנראה כמו כסף (למשל 11,032 או 661) בטקסט הגלוי. בודקים את
      // c.text (ללא הקישור) - לא את ה-HTML, שבו יש מספרי CSS לגיטימיים (padding וכו').
      expect(/\d{3,}/.test(c.text.replace(link, ""))).toBe(false);
    }
  });

  it("הקישור בולט בכפתור ומצוין שהוא דורש התחברות", () => {
    const c = buildContent("comparison_ready", link);
    expect(c.html).toContain("דורש התחברות");
  });
});