// tests/agent/turn-meter.test.ts
// בדיקת המודד (ללא מודל/API): שעון מוזרק + אירועים מושהים.
// מכסה את שני הבאגים שדווחו:
//  1) TTFT מול total בתור השוואה רב-שלבי (טקסט מגיע מאוחר - זה אמיתי, לא אגירה).
//  2) זמן תוצאת-כלי (compareScenarios) נתפס נכון - לפי status="success" (לא "ok").
import { describe, it, expect } from "vitest";
import { createTurnMeter } from "../../src/server/agent/turn-meter.js";

// שעון מדומה הניתן לקידום ידני.
function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe("turn-meter: הפרדת זמני שרת", () => {
  it("תור השוואה רב-שלבי: תוצאת הכלי מוכנה מוקדם, טקסט מגיע מאוחר", () => {
    const clk = fakeClock();
    const meter = createTurnMeter(clk.now);

    // צעד 1: קריאת מודל + קריאת כלי compareScenarios (thinking לקח זמן).
    clk.advance(4000);
    meter.onStepFinish({
      toolCalls: [{ toolName: "compareScenarios", input: {} }],
      toolResults: [{ toolName: "compareScenarios", output: { status: "success", data: { ok: true } } }],
    });
    const compareReadyAt = 4000;

    // צעד 2: המודל מנסח תשובה. הטקסט הראשון נשלח רק עכשיו (מאוחר).
    clk.advance(3000);
    meter.onChunk({ type: "text-delta" });
    clk.advance(500); // המשך טקסט
    meter.onStepFinish({ toolCalls: [], toolResults: [] });

    clk.advance(50); // סיום
    const m = meter.finalize({ inputTokens: 12000, outputTokens: 300 });

    // תוצאת הכלי הייתה מוכנה ב-4000ms - הרבה לפני הטקסט (7000ms).
    expect(m.compareResultMs).toBe(compareReadyAt);
    expect(m.toolResultMs).toBe(compareReadyAt);
    expect(m.firstTextMs).toBe(7000);
    expect(m.totalMs).toBe(7550);
    // ההוכחה: TTFT≈total לא נבע מאגירה אלא מכך שהטקסט באמת מגיע בשלב האחרון.
    // ועכשיו יש לנו מדד נפרד לזמן תוצאת-הכלי (compareResultMs << firstTextMs).
    expect(m.compareResultMs!).toBeLessThan(m.firstTextMs!);
    expect(m.modelCalls).toBe(2);
    expect(m.toolCount).toBe(1);
  });

  it("תוצאת כלי עם status='success' נתפסת (הבאג: קודם חיפשנו 'ok')", () => {
    const clk = fakeClock();
    const meter = createTurnMeter(clk.now);
    clk.advance(100);
    meter.onStepFinish({
      toolCalls: [{ toolName: "compareScenarios" }],
      toolResults: [{ toolName: "compareScenarios", output: { status: "success", data: {} } }],
    });
    const m = meter.finalize();
    expect(m.compareResultMs).toBe(100); // לא null
  });

  it("status שאינו success אינו נספר כתוצאה מוכנה", () => {
    const clk = fakeClock();
    const meter = createTurnMeter(clk.now);
    clk.advance(100);
    meter.onStepFinish({
      toolCalls: [{ toolName: "compareScenarios" }],
      toolResults: [{ toolName: "compareScenarios", output: { status: "missing_data" } }],
    });
    const m = meter.finalize();
    expect(m.compareResultMs).toBeNull();
    expect(m.toolResultMs).toBeNull();
  });

  it("תור ברכה פשוט: טקסט מיידי, בלי כלים", () => {
    const clk = fakeClock();
    const meter = createTurnMeter(clk.now);
    clk.advance(800);
    meter.onChunk({ type: "text-delta" });
    clk.advance(50);
    meter.onStepFinish({ toolCalls: [], toolResults: [] });
    const m = meter.finalize();
    expect(m.firstTextMs).toBe(800);
    expect(m.toolResultMs).toBeNull();
    expect(m.toolCount).toBe(0);
    expect(m.modelCalls).toBe(1);
  });

  it("chunk ראשון שאינו טקסט (reasoning) אינו קובע את firstTextMs", () => {
    const clk = fakeClock();
    const meter = createTurnMeter(clk.now);
    clk.advance(200);
    meter.onChunk({ type: "reasoning-delta" }); // לא טקסט
    clk.advance(300);
    meter.onChunk({ type: "text-delta" });      // הטקסט האמיתי הראשון
    const m = meter.finalize();
    expect(m.firstTextMs).toBe(500);
  });
});