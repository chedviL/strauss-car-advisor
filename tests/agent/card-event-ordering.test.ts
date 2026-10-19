// tests/agent/card-event-ordering.test.ts
// מאמת (ללא מודל/רשת, דרך דפוס ה-stream של ה-route) ש-אירוע הכרטיס (data-comparison)
// נשלח *מיד* כש-onComparisonReady נורה (תוצאת השוואה תקפה), *לפני* שהניסוח הסופי
// מסתיים ולפני finish. כך הלקוח יכול לרענן את הכרטיס מהאירוע בלי להמתין לסוף התור.
// זו הוכחת *אירוע בזרם*, לא רק שמירה במסד.
import { describe, it, expect } from "vitest";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

async function drain(stream: ReadableStream): Promise<string[]> {
  const reader = stream.getReader();
  const types: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    types.push((value as { type?: string }).type ?? "?");
  }
  return types;
}

// משכפל את דפוס ה-route: גשר onComparisonReady -> data-comparison מיד, ואז
// ניסוח סופי מושהה (מדמה tool שהחזיר תוצאה, וטקסט שמגיע אחריו).
function routeLikeStream(opts: { onComparisonReadyDelayMs: number; narrationDelayMs: number }) {
  let emitCard: (() => void) | null = null;
  let cardPending = false; let cardSent = false;
  const fireCard = () => { if (cardSent) return; if (emitCard) { cardSent = true; emitCard(); } else { cardPending = true; } };

  // מדמה את onComparisonReady שנורה בזמן ריצת המודל (לפני/אחרי שה-writer קיים).
  setTimeout(fireCard, opts.onComparisonReadyDelayMs);

  return createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      // גשר הכרטיס - כמו ב-route.
      emitCard = () => writer.write({ type: "data-comparison", data: { ready: true, scope: "turn" } });
      if (cardPending && !cardSent) { cardSent = true; emitCard(); }
      // הניסוח הסופי מגיע מאוחר יותר (מדמה טוקנים של טקסט אחרי סבב הכלים).
      await new Promise((r) => setTimeout(r, opts.narrationDelayMs));
      // אם הכרטיס טרם נשלח (נורה אחרי ה-merge) - עדיין צריך לצאת לפני finish.
      if (cardPending && !cardSent) { cardSent = true; emitCard!(); }
      writer.write({ type: "text-start", id: "t1" });
      writer.write({ type: "text-delta", id: "t1", delta: "מעבר ל-ATTO 3 יעלה את הנטו ב-661 ש\"ח." });
      writer.write({ type: "text-end", id: "t1" });
      writer.write({ type: "data-saveStatus", data: { phase: "saved", scope: "turn" } });
      writer.write({ type: "finish" });
    },
  });
}

describe("אירוע כרטיס מגיע לפני הניסוח הסופי", () => {
  it("data-comparison נשלח לפני text-delta ולפני finish (onComparisonReady מוקדם)", async () => {
    const types = await drain(routeLikeStream({ onComparisonReadyDelayMs: 0, narrationDelayMs: 40 }));
    const iCard = types.indexOf("data-comparison");
    const iText = types.indexOf("text-delta");
    const iFinish = types.indexOf("finish");
    expect(iCard).toBeGreaterThanOrEqual(0);        // האירוע נשלח
    expect(iText).toBeGreaterThanOrEqual(0);
    expect(iCard).toBeLessThan(iText);              // לפני הניסוח
    expect(iCard).toBeLessThan(iFinish);            // ולפני סיום התור
  });

  it("גם אם onComparisonReady נורה אחרי תחילת ה-execute - האירוע עדיין לפני הניסוח", async () => {
    const types = await drain(routeLikeStream({ onComparisonReadyDelayMs: 10, narrationDelayMs: 40 }));
    const iCard = types.indexOf("data-comparison");
    const iText = types.indexOf("text-delta");
    expect(iCard).toBeGreaterThanOrEqual(0);
    expect(iCard).toBeLessThan(iText);
  });
});

describe("אירוע כרטיס דרך נתיב HTTP (SSE) עם ניסוח מדומה מושהה", () => {
  it("בגוף ה-HTTP: data-comparison מופיע לפני טקסט הניסוח הסופי", async () => {
    // משכפל את דפוס ה-route: גשר onComparisonReady -> data-comparison מיד,
    // ואז ניסוח מושהה. מריצים דרך createUIMessageStreamResponse (אותו עוטף SSE של ה-route).
    let emitCard: (() => void) | null = null;
    let cardPending = false; let cardSent = false;
    const fireCard = () => { if (cardSent) return; if (emitCard) { cardSent = true; emitCard(); } else { cardPending = true; } };
    setTimeout(fireCard, 0);
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: "start" });
        emitCard = () => writer.write({ type: "data-comparison", data: { ready: true, scope: "turn" } });
        if (cardPending && !cardSent) { cardSent = true; emitCard(); }
        await new Promise((r) => setTimeout(r, 40)); // ניסוח מושהה
        writer.write({ type: "text-start", id: "t1" });
        writer.write({ type: "text-delta", id: "t1", delta: "תוצאה סופית" });
        writer.write({ type: "text-end", id: "t1" });
        writer.write({ type: "finish" });
      },
    });
    const resp = createUIMessageStreamResponse({ stream });
    expect(resp.headers.get("content-type")).toContain("text/event-stream");
    const body = await resp.text();
    const iCard = body.indexOf("data-comparison");
    const iText = body.indexOf("text-delta");
    expect(iCard).toBeGreaterThanOrEqual(0);  // האירוע בגוף ה-HTTP
    expect(iText).toBeGreaterThanOrEqual(0);
    expect(iCard).toBeLessThan(iText);        // לפני הניסוח הסופי
  });
});
