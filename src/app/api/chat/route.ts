// src/app/api/chat/route.ts
// נתיב streaming לשיחה. זהות (owner/case) מה-cookie בלבד - לעולם לא מהלקוח.
// משתמש ב-runtime (ששת הכלים + מודל). אין חישוב כאן; רק תזמור.

import { cookies } from "next/headers";
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { caseService } from "../../../server/web/service.js";
import { getOrCreateVisitOwner } from "../../../server/web/visit.js";
import { streamChat, stripReasoning, type ChatBudgetState } from "../../../server/agent/chat-runtime.js";
import type { ToolContext } from "../../../server/agent/tool-contracts.js";
import { fastPathEnabled } from "../../../server/agent/model.js";
import { runFastPlan, narrateResult } from "../../../server/agent/fast-path.js";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

// תקציב מצטבר לכל התהליך (אומדן, לא תקרת חיוב).
const budget: ChatBudgetState = { estimatedUsd: 0, calls: 0 };

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

  const ctx: ToolContext = {
    ownerId: owner, caseId: caseId!, staffRole: null, requestId: randomUUID(), messageId: null,
  };

  // מסירים reasoning מההיסטוריה לפני שליחה (binding של thinking ב-Claude).
  const modelMessages = stripReasoning(await convertToModelMessages(messages));

  // שומרים את הודעת המשתמש האחרונה (dedup לפי id) כדי שתשרוד רענון.
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (lastUser) {
    await service.appendMessages(ctx.caseId, owner, [
      { role: "user", clientMessageId: lastUser.id, content: lastUser.parts },
    ]).catch(() => {});
  }

  // --- חתך מבני (דגל): תוכנית פעולות בקריאת מודל אחת. מבצעת עדכונים/סימולציה/
  //     השוואה בקוד, מציגה כרטיס מהתוצאה השמורה, ומחזירה תשובה - בלי הבנה כפולה. ---
  if (fastPathEnabled() && lastUser) {
    const userText = (lastUser.parts as Array<{ type: string; text?: string }>)
      .filter((p) => p.type === "text").map((p) => p.text).join(" ");
    try {
      const fp = await runFastPlan(service, ctx.caseId, owner, state, userText);
      // תלוי-תוצאה: ממשיכים למודל עם התוצאה בפועל (לא מתחילים שוב את ההבנה).
      // זו קריאת-המשך קצרה שמנסחת הסבר מבוסס-תוצאה; הכרטיס כבר נשמר.
      const reply = fp.needsFollowup
        ? await narrateResult(userText, fp.actionResults)
        : fp.reply;
      const asstId = "asst-" + randomUUID();
      const stream = createUIMessageStream({
        execute: ({ writer }) => {
          // מעטפת הודעה: start/finish נדרשים כדי שה-client (useChat) ייצור את
          // הודעת העוזר ויצרף אליה את הטקסט. בלעדיהם שום דבר לא מופיע.
          const id = "t-" + randomUUID();
          writer.write({ type: "start" });
          writer.write({ type: "text-start", id });
          writer.write({ type: "text-delta", id, delta: reply });
          writer.write({ type: "text-end", id });
          writer.write({ type: "finish" });
        },
        onFinish: () => {
          void service.appendMessages(ctx.caseId, owner, [
            { role: "assistant", clientMessageId: asstId, content: [{ type: "text", text: reply }] },
          ]).catch(() => {});
        },
      });
      return createUIMessageStreamResponse({ stream });
    } catch {
      // כשל במסלול המהיר -> נופלים בבטחה למסלול הכלים המלא (הבנה מלאה).
      // (עדכוני עובדות שכבר בוצעו נשמרו במסד.)
    }
  }

  try {
    const result = streamChat({ service, ctx, state, messages: modelMessages, budget });
    return result.toUIMessageStreamResponse({
      // כשהתור מסתיים, שומרים את הודעת העוזר לשחזור.
      onFinish: ({ responseMessage }) => {
        if (responseMessage) {
          // responseMessage.id עשוי להיות ריק; בלי מזהה ייחודי כל ההודעות
          // מתנגשות על (case_id, "") והאינדקס מפיל אותן. יוצרים מזהה ודאי.
          const cid =
            responseMessage.id && responseMessage.id.trim() !== ""
              ? responseMessage.id
              : "asst-" + randomUUID();
          void service.appendMessages(ctx.caseId, owner, [
            { role: "assistant", clientMessageId: cid, content: responseMessage.parts },
          ]).catch(() => {});
        }
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // מסננים כל דבר שנראה כמו מפתח מהודעת השגיאה.
    const safe = msg.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***");
    return new Response(JSON.stringify({ error: safe }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
}