// src/app/api/chat/route.ts
// נתיב streaming לשיחה. זהות (owner/case) מה-cookie בלבד - לעולם לא מהלקוח.
// משתמש ב-runtime (ששת הכלים + מודל). אין חישוב כאן; רק תזמור.
//
// שמירה: await אמיתי לכתיבה בתוך ה-stream (לא void ללא מעקב). הטקסט מוזרם
// ללקוח לפני שהכתיבה מסתיימת; לאחר הכתיבה נשלח data-saveStatus כדי שכשל
// יגיע לממשק עם אפשרות ניסיון חוזר (ולא יישאר רק בלוג).
// consumeSseStream מבטיח שהשמירה תרוץ גם כשהלקוח מתנתק (ניתוק != קריסת שרת).

import { cookies } from "next/headers";
import {
  convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse,
  consumeStream, type UIMessage,
} from "ai";
import { caseService } from "../../../server/web/service.js";
import { getOrCreateVisitOwner } from "../../../server/web/visit.js";
import { streamChat, stripReasoning, type ChatBudgetState } from "../../../server/agent/chat-runtime.js";
import type { ToolContext } from "../../../server/agent/tool-contracts.js";
import { fastPathEnabled } from "../../../server/agent/model.js";
import { runFastPlan, narrateResult } from "../../../server/agent/fast-path.js";
import type { CaseService } from "../../../server/services/case-service.js";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

// תקציב מצטבר לכל התהליך (אומדן, לא תקרת חיוב).
const budget: ChatBudgetState = { estimatedUsd: 0, calls: 0 };

/** שמירת הודעת המשתמש בלבד (idempotent), כש-המודל נכשל לפני אירוע הסיום. */
async function saveUserMessage(
  service: CaseService, caseId: string, owner: string, lastUser: UIMessage,
): Promise<void> {
  await service.appendMessages(caseId, owner, [
    { role: "user", clientMessageId: lastUser.id, content: lastUser.parts },
  ]);
}

// data-part לחיווי מצב שמירה ללקוח. saved=false -> הממשק מציג כשל + ניסיון חוזר.
type SaveStatusData = { saved: boolean; scope: "turn" };

export async function POST(req: Request): Promise<Response> {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const owner = await getOrCreateVisitOwner();
  const store = await cookies();
  let caseId = store.get("strauss_case")?.value ?? null;
  const service = caseService();

  // שימוש אמיתי: אם אין תיק פעיל, פותחים תיק ריק מהשיחה (עובדות ריקות).
  let state = caseId ? await service.getCaseState(caseId, owner) : null;
  if (!state) {
    const created = await service.startBlankCase(owner);
    caseId = created.case.id;
    state = created;
    store.set("strauss_case", caseId, {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7,
    });
  }
  const cid = caseId!;

  const ctx: ToolContext = {
    ownerId: owner, caseId: cid, staffRole: null, requestId: randomUUID(), messageId: null,
  };

  // מסירים reasoning מההיסטוריה לפני שליחה (binding של thinking ב-Claude).
  const modelMessages = stripReasoning(await convertToModelMessages(messages));
  const lastUser = [...messages].reverse().find((m) => m.role === "user");

  // --- חתך מבני (דגל): תוכנית פעולות בקריאת מודל אחת. ---
  if (fastPathEnabled() && lastUser) {
    const userText = (lastUser.parts as Array<{ type: string; text?: string }>)
      .filter((p) => p.type === "text").map((p) => p.text).join(" ");
    const tA0 = Date.now();
    try {
      const fp = await runFastPlan(service, cid, owner, state, userText, modelMessages);
      console.log(
        `[chat] path=A did=${Object.entries(fp.did).filter(([, v]) => v).map(([k]) => k).join(",") || "none"} followup=${fp.needsFollowup}`,
      );
      const reply = fp.needsFollowup
        ? await narrateResult(userText, fp.actionResults)
        : fp.reply;
      console.log(`[measure] path=A modelCalls=${fp.needsFollowup ? 2 : 1} ttft_ms=${Date.now() - tA0}`);
      const asstId = "asst-" + randomUUID();
      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          // 1) הטקסט נשלח מיד (לפני השמירה) -> אין עיכוב להופעת הטקסט.
          const id = "t-" + randomUUID();
          writer.write({ type: "start" });
          writer.write({ type: "text-start", id });
          writer.write({ type: "text-delta", id, delta: reply });
          writer.write({ type: "text-end", id });
          // 2) כעת await אמיתי לשמירה; הטקסט כבר אצל הלקוח.
          const tSave = Date.now();
          let saved = false;
          try {
            await service.appendMessages(cid, owner, [
              { role: "user", clientMessageId: lastUser.id, content: lastUser.parts },
              { role: "assistant", clientMessageId: asstId, content: [{ type: "text", text: reply }] },
            ]);
            saved = true;
            console.log(`[measure] path=A turn-save_ms=${Date.now() - tSave} saved=ok`);
          } catch (e) {
            console.warn(`[measure] path=A turn-save FAILED: ${e instanceof Error ? e.message : String(e)} saved=no`);
          }
          // 3) חיווי מצב שמירה ללקוח (כשל -> ניסיון חוזר בממשק).
          writer.write({ type: "data-saveStatus", data: { saved, scope: "turn" } satisfies SaveStatusData });
          writer.write({ type: "finish" });
        },
      });
      return createUIMessageStreamResponse({ stream, consumeSseStream: consumeStream });
    } catch (e) {
      await saveUserMessage(service, cid, owner, lastUser).catch((se) =>
        console.warn(`[chat] path=A user-save on model-fail FAILED: ${se instanceof Error ? se.message : String(se)}`),
      );
      const m = e instanceof Error ? e.message : String(e);
      console.log(`[chat] path=A->B fallback (${m.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***").slice(0, 80)})`);
    }
  }

  // --- מסלול B: שיחה טבעית + כלים. ---
  try {
    console.log("[chat] path=B (full tool loop)");
    const result = streamChat({ service, ctx, state, messages: modelMessages, budget });
    // consumeStream (ללא await): מסיר backpressure כך שה-LLM רץ עד הסוף גם אם
    // הלקוח מתנתק -> ה-merge מסתיים והשמירה תתבצע. (ניתוק לקוח בלבד; לא קריסת שרת.)
    void result.consumeStream();

    const stream = createUIMessageStream({
      originalMessages: messages,
      execute: async ({ writer }) => {
        // ממזגים את stream המודל (טקסט/כלים) -> מוזרם ללקוח מיד.
        writer.merge(result.toUIMessageStream({ sendFinish: false }));
        // ממתינים לסיום המודל כדי לקבל את הטקסט המלא של העוזר לשמירה.
        let assistantText = "";
        try { assistantText = await result.text; } catch { assistantText = ""; }
        const aid = "asst-" + randomUUID();
        const tSave = Date.now();
        let saved = false;
        try {
          await service.appendMessages(cid, owner, [
            ...(lastUser ? [{ role: "user" as const, clientMessageId: lastUser.id, content: lastUser.parts }] : []),
            { role: "assistant" as const, clientMessageId: aid, content: [{ type: "text", text: assistantText }] },
          ]);
          saved = true;
          console.log(`[measure] path=B turn-save_ms=${Date.now() - tSave} saved=ok`);
        } catch (e) {
          console.warn(`[measure] path=B turn-save FAILED: ${e instanceof Error ? e.message : String(e)} saved=no`);
        }
        writer.write({ type: "data-saveStatus", data: { saved, scope: "turn" } satisfies SaveStatusData });
        writer.write({ type: "finish" });
      },
    });
    return createUIMessageStreamResponse({ stream, consumeSseStream: consumeStream });
  } catch (e) {
    if (lastUser) {
      await saveUserMessage(service, cid, owner, lastUser).catch((se) =>
        console.warn(`[chat] path=B user-save on model-fail FAILED: ${se instanceof Error ? se.message : String(se)}`),
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    const safe = msg.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***");
    return new Response(JSON.stringify({ error: safe }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
}
