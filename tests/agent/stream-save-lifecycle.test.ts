// tests/agent/stream-save-lifecycle.test.ts
// דפוס הסיום הנתמך של ה-SDK (createUIMessageStream + onEnd) עם await אמיתי לשמירה.
// מאמת (ללא מודל/רשת):
//  - הטקסט מגיע לצרכן לפני שהשמירה מסתיימת (onEnd רץ בסוף, לא חוסם delta).
//  - onEnd מופעל ומסיים את ה-await לשמירה לפני סגירת ה-stream.
//  - כשל שמירה אינו מתפרש כהשלמה שנשמרה (saved נשאר false).
//  - ניתוק (cancel של ה-reader) מפעיל את onEnd (עם isAborted).
import { describe, it, expect } from "vitest";
import { createUIMessageStream } from "ai";

// צרכן שקורא את כל ה-stream ומחזיר את רצף סוגי ה-chunks + חותמות זמן.
async function drain(stream: ReadableStream): Promise<{ types: string[]; firstDeltaAt: number }> {
  const reader = stream.getReader();
  const types: string[] = [];
  let firstDeltaAt = 0;
  const t0 = Date.now();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const type = (value as { type?: string }).type ?? "?";
    types.push(type);
    if (type === "text-delta" && firstDeltaAt === 0) firstDeltaAt = Date.now() - t0;
  }
  return { types, firstDeltaAt };
}

function replyStream(reply: string, onEnd: (ctx: { isAborted: boolean }) => Promise<void>) {
  return createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: "start" });
      writer.write({ type: "text-start", id: "t1" });
      writer.write({ type: "text-delta", id: "t1", delta: reply });
      writer.write({ type: "text-end", id: "t1" });
      writer.write({ type: "finish" });
    },
    onEnd: async ({ isAborted }) => { await onEnd({ isAborted: !!isAborted }); },
  });
}

describe("דפוס סיום stream עם שמירה (onEnd, await אמיתי)", () => {
  it("הצלחה: onEnd רץ, שמירה הושלמה, saved=true, וכל ה-chunks הגיעו", async () => {
    let saved = false; let endRan = false;
    const stream = replyStream("שלום", async () => {
      await new Promise((r) => setTimeout(r, 30)); // כתיבה איטית מדומה
      saved = true; endRan = true;
    });
    const { types } = await drain(stream);
    expect(types).toContain("text-delta");
    expect(types).toContain("finish");
    expect(endRan).toBe(true);
    expect(saved).toBe(true); // ה-await ל-onEnd הסתיים לפני שה-stream נסגר
  });

  it("הטקסט מגיע לפני שהשמירה מסתיימת: delta מתקבל, השמירה עדיין רצה", async () => {
    let saveStarted = false; let saveDone = false;
    // צרכן ידני שבודק את מצב השמירה ברגע שהגיע ה-delta הראשון.
    const stream = replyStream("טקסט", async () => {
      saveStarted = true;
      await new Promise((r) => setTimeout(r, 50));
      saveDone = true;
    });
    const reader = stream.getReader();
    let deltaSeenWhileSaveNotDone = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if ((value as { type?: string }).type === "text-delta") {
        // ברגע שהגיע ה-delta, השמירה עוד לא הסתיימה (onEnd רץ רק ב-flush).
        deltaSeenWhileSaveNotDone = !saveDone;
      }
    }
    expect(deltaSeenWhileSaveNotDone).toBe(true); // הטקסט הגיע לפני סיום הכתיבה
    expect(saveStarted).toBe(true);
    expect(saveDone).toBe(true); // בסוף, השמירה הסתיימה (onEnd הואוחל)
  });

  it("כשל שמירה אינו מסומן כהצלחה (saved=false), והצרכן עדיין מקבל את הטקסט", async () => {
    let saved = false; let caught = "";
    const stream = replyStream("תוכן", async () => {
      try {
        await Promise.reject(new Error("db down"));
        saved = true;
      } catch (e) {
        caught = e instanceof Error ? e.message : String(e);
        // לא מסמנים saved=true -> לא "הצלחה שנשמרה"
      }
    });
    const { types } = await drain(stream);
    expect(types).toContain("text-delta"); // הטקסט הגיע ללקוח למרות כשל השמירה
    expect(saved).toBe(false); // כשל כתיבה != השלמה שנשמרה
    expect(caught).toBe("db down");
  });

  it("ניתוק (cancel): onEnd מופעל כדי שאפשר יהיה לשמור/לסמן מצב", async () => {
    let endRan = false;
    const stream = replyStream("ארוך", async () => { endRan = true; });
    const reader = stream.getReader();
    await reader.read();        // קוראים chunk אחד
    await reader.cancel("user navigated away"); // ניתוק באמצע
    // cancel ב-handleUIMessageStreamFinish קורא ל-callOnEnd
    await new Promise((r) => setTimeout(r, 20));
    expect(endRan).toBe(true);
  });
});

// --- חיווי מצב שמירה ללקוח (data-saveStatus), כפי שה-route שולח ---
// משכפל את דפוס ה-route: טקסט -> await שמירה -> כתיבת data-saveStatus -> finish.
function replyStreamWithStatus(reply: string, save: () => Promise<void>) {
  return createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      writer.write({ type: "text-start", id: "t1" });
      writer.write({ type: "text-delta", id: "t1", delta: reply });
      writer.write({ type: "text-end", id: "t1" });
      let saved = false;
      try { await save(); saved = true; } catch { saved = false; }
      writer.write({ type: "data-saveStatus", data: { saved, scope: "turn" } });
      writer.write({ type: "finish" });
    },
  });
}

async function collect(stream: ReadableStream): Promise<Array<Record<string, unknown>>> {
  const reader = stream.getReader();
  const chunks: Array<Record<string, unknown>> = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Record<string, unknown>);
  }
  return chunks;
}

describe("חיווי מצב שמירה ללקוח (data-saveStatus)", () => {
  it("שמירה מצליחה -> data-saveStatus עם saved=true, אחרי הטקסט", async () => {
    const chunks = await collect(replyStreamWithStatus("שלום", async () => { /* ok */ }));
    const statusIdx = chunks.findIndex((c) => c.type === "data-saveStatus");
    const deltaIdx = chunks.findIndex((c) => c.type === "text-delta");
    expect(statusIdx).toBeGreaterThan(deltaIdx); // החיווי אחרי הטקסט
    expect((chunks[statusIdx]!.data as { saved: boolean }).saved).toBe(true);
  });

  it("שמירה נכשלת -> data-saveStatus עם saved=false (כשל מגיע לממשק, לא רק ללוג)", async () => {
    const chunks = await collect(replyStreamWithStatus("שלום", async () => { throw new Error("db down"); }));
    const status = chunks.find((c) => c.type === "data-saveStatus");
    expect(status).toBeTruthy();
    expect((status!.data as { saved: boolean }).saved).toBe(false);
    // הטקסט עדיין נשלח למרות כשל השמירה
    expect(chunks.some((c) => c.type === "text-delta")).toBe(true);
  });
});
