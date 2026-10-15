// src/app/api/chat/route.ts
// נתיב streaming לשיחה. זהות (owner/case) מה-cookie בלבד - לעולם לא מהלקוח.
// משתמש ב-runtime (ששת הכלים + מודל). אין חישוב כאן; רק תזמור.

import { cookies } from "next/headers";
import { convertToModelMessages, type UIMessage } from "ai";
import { caseService } from "../../../server/web/service.js";
import { getOrCreateVisitOwner } from "../../../server/web/visit.js";
import { streamChat, stripReasoning, type ChatBudgetState } from "../../../server/agent/chat-runtime.js";
import type { ToolContext } from "../../../server/agent/tool-contracts.js";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

// תקציב מצטבר לכל התהליך (אומדן, לא תקרת חיוב).
const budget: ChatBudgetState = { estimatedUsd: 0, calls: 0 };

export async function POST(req: Request): Promise<Response> {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const owner = await getOrCreateVisitOwner();
  const store = await cookies();
  const caseId = store.get("strauss_case")?.value ?? null;
  const service = caseService();

  if (!caseId) {
    return new Response(
      JSON.stringify({ error: "אין תיק פעיל. בחר/י עובד/ת להתחלה." }),
      { status: 409, headers: { "content-type": "application/json" } },
    );
  }
  const state = await service.getCaseState(caseId, owner);
  if (!state) {
    return new Response(
      JSON.stringify({ error: "התיק לא נמצא או אינו בהרשאת הביקור." }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }

  const ctx: ToolContext = {
    ownerId: owner, caseId, staffRole: null, requestId: randomUUID(), messageId: null,
  };

  // מסירים reasoning מההיסטוריה לפני שליחה (binding של thinking ב-Claude).
  const modelMessages = stripReasoning(await convertToModelMessages(messages));

  try {
    const result = streamChat({ service, ctx, state, messages: modelMessages, budget });
    return result.toUIMessageStreamResponse();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // מסננים כל דבר שנראה כמו מפתח מהודעת השגיאה.
    const safe = msg.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***");
    return new Response(JSON.stringify({ error: safe }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
}