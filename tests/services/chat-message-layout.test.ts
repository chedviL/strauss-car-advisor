// tests/services/chat-message-layout.test.ts
// רגרסיית פריסת הודעות (ללא דפדפן ובלי מודל): מעטפת העוזר חייבת להיות יציבה ומעוגנת לימין,
// כדי שבזמן streaming תחילת המשפט לא תזוז. המדידה בדפדפן אמיתי (Edge, הזרמה מדומה של 30 chunks)
// הראתה: לפני - המעטפת גדלה 68->656px ותחילת המשפט זזה 588px; אחרי - מעטפת קבועה ו-0px.
import { describe, it, expect } from "vitest";
import {
  assistantEnvelopeStyle, userEnvelopeStyle, rowStyle,
} from "../../src/features/advisor/chat-message-layout.js";

describe("פריסת הודעות: מעטפת יציבה, RTL, יישור לימין", () => {
  it("מעטפת העוזר ברוחב קבוע ולא מצומצמת לתוכן", () => {
    expect(assistantEnvelopeStyle.width).toBe("100%");
    expect(assistantEnvelopeStyle.maxWidth).toBe("100%");
    // רוחב שתלוי בתוכן יגרום למעטפת לגדול בזמן ההזרמה ולהזיז את המשפט.
    for (const bad of ["auto", "fit-content", "max-content", "min-content"]) {
      expect(String(assistantEnvelopeStyle.width)).not.toBe(bad);
    }
  });

  it("כיוון ויישור מפורשים: rtl + right (לא plaintext)", () => {
    for (const s of [assistantEnvelopeStyle, userEnvelopeStyle]) {
      expect(s.direction).toBe("rtl");
      expect(s.textAlign).toBe("right");
      // plaintext קובע כיוון לפי התו החזק הראשון ולכן שורה שנפתחת באנגלית הייתה הופכת ל-LTR.
      expect(s.unicodeBidi).not.toBe("plaintext");
    }
  });

  it("שורת ההודעה מעוגנת לצד ההתחלה (ימין ב-RTL), לא flex-end (שמאל)", () => {
    expect(rowStyle.direction).toBe("rtl");
    expect(rowStyle.justifyContent).toBe("flex-start");
  });

  it("בועת המשתמש/ת מוגבלת ברוחב וגם היא מעוגנת לימין", () => {
    expect(userEnvelopeStyle.maxWidth).toBe("88%");
    expect(userEnvelopeStyle.width).toBeUndefined();
  });
});