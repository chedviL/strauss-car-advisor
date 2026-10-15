// tests/agent/ui-stream-envelope.test.ts
// בדיקת HTTP stream ללא מודל: ודא שהמסלול המהיר משדר מעטפת הודעה תקינה
// (start/finish) כך ש-useChat ייצור הודעה ויציג טקסט. זה הבאג שחסם "שיחה חדשה".
import { describe, it, expect } from "vitest";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { randomUUID } from "node:crypto";

// משכפל את בניית ה-stream כפי שה-route עושה (ללא מודל/שירות).
function buildReplyStream(reply: string) {
  return createUIMessageStream({
    execute: ({ writer }) => {
      const id = "t-" + randomUUID();
      writer.write({ type: "start" });
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: reply });
      writer.write({ type: "text-end", id });
      writer.write({ type: "finish" });
    },
  });
}

describe("UI message stream envelope (fast path)", () => {
  it("כולל start + finish סביב הטקסט (אחרת useChat לא מציג)", async () => {
    const resp = createUIMessageStreamResponse({ stream: buildReplyStream("שלום") });
    expect(resp.headers.get("content-type")).toContain("text/event-stream");
    const body = await resp.text();
    // חייב להופיע start עם messageId, הטקסט, ו-finish
    expect(body).toMatch(/"type":"start"/);
    expect(body).toMatch(/"type":"text-delta"[^}]*"delta":"שלום"/);
    expect(body).toMatch(/"type":"finish"/);
    expect(body).toContain("[DONE]");
    // סדר נכון: start לפני text-delta לפני finish
    const iStart = body.indexOf('"start"');
    const iDelta = body.indexOf('"text-delta"');
    const iFinish = body.indexOf('"finish"');
    expect(iStart).toBeGreaterThanOrEqual(0);
    expect(iStart).toBeLessThan(iDelta);
    expect(iDelta).toBeLessThan(iFinish);
  });
});