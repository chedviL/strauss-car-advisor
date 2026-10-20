// tests/agent/stream-progressive.test.ts
// מאמת (ללא מודל/רשת) שדפוס ה-route — writer.merge של זרם המודל — מעביר טקסט
// *בהדרגה* ללקוח לפני סיום התור, ושאירוע הכרטיס מגיע בזמן. מדמה chunks מושהים.
// זו הגנה מפני רגרסיית streaming (buffer-then-decide שאוגר תשובה שלמה).
import { describe, it, expect } from "vitest";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

// זרם UI מדומה שמשדר שלושה text-delta בהשהיות (כמו טוקנים מהמודל).
function delayedModelUiStream(): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      const id = "m1";
      controller.enqueue({ type: "text-start", id });
      for (const [i, chunk] of ["חלק ראשון ", "חלק שני ", "חלק שלישי"].entries()) {
        await new Promise((r) => setTimeout(r, 30));
        controller.enqueue({ type: "text-delta", id, delta: chunk, _at: Date.now(), _i: i });
      }
      controller.enqueue({ type: "text-end", id });
      controller.close();
    },
  });
}

describe("streaming הדרגתי דרך writer.merge (ללא רגרסיה)", () => {
  it("הלקוח מקבל text-delta בהדרגה לפני finish, ו-data-comparison בזמן", async () => {
    const t0 = Date.now();
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: "start" });
        writer.write({ type: "data-activeCase", data: { caseId: "c1", scope: "turn" } });
        // ממזגים את זרם המודל המדומה (חי) - כמו ה-route במקרה firstChunk.
        writer.merge(delayedModelUiStream() as never);
        // אירוע כרטיס נשלח תוך כדי (מדמה onComparisonReady אחרי השמירה).
        await new Promise((r) => setTimeout(r, 200));
        writer.write({ type: "data-comparison", data: { ready: true, scope: "turn" } });
        writer.write({ type: "finish" });
      },
    });
    // צורכים את הזרם ומתעדים זמני הגעה של כל part.
    const reader = (stream as unknown as ReadableStream).getReader();
    const events: Array<{ type: string; at: number }> = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      events.push({ type: (value as { type?: string }).type ?? "?", at: Date.now() - t0 });
    }
    const deltas = events.filter((e) => e.type === "text-delta");
    const finishAt = events.find((e) => e.type === "finish")!.at;
    const cardAt = events.find((e) => e.type === "data-comparison")!.at;
    // (1) לפחות שני delta הגיעו לפני finish (הדרגתי, לא אגירה).
    const deltasBeforeFinish = deltas.filter((d) => d.at < finishAt).length;
    expect(deltasBeforeFinish).toBe(3); // כל ה-delta הגיעו לפני finish (הדרגתי)
    // (2) ה-delta הראשון הגיע מוקדם (לא בבת אחת בסוף): לפני ה-delta האחרון בפער מורגש.
    expect(deltas.length).toBe(3);
    expect(deltas[2]!.at - deltas[0]!.at).toBeGreaterThanOrEqual(40); // ~2x30ms השהיה
    // (3) אירוע הכרטיס הגיע (לפני/סביב ה-finish), לא חסר.
    expect(cardAt).toBeLessThanOrEqual(finishAt);
  });
});
