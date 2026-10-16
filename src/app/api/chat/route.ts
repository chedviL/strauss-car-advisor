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

  const lastUser = [...messages].reverse().find((m) => m.role === "user");

  // שמירת הודעת המשתמש: מתוזמנת ב-void (לא חוסמת את המודל).
  // runtime=nodejs — הלולאה ממשיכה אחרי שה-Response נשלח; ה-promise יושלם.
  // ה-void בטוח כי: (א) Next.js Node runtime לא מסיים את ה-process בסיום הבקשה,
  //                  (ב) הלקוח שולח את ההודעה שוב בכל תור (dedup על client_message_id).
  // כשל בשמירה נרשם בלוג בלבד; הלקוח מציג את ההודעה ושולח אותה מחדש בתור הבא.
  const tSave0 = Date.now();
  const userSavePromise = lastUser
    ? service.appendMessages(ctx.caseId, owner, [
        { role: "user", clientMessageId: lastUser.id, content: lastUser.parts },
      ]).then(() => {
        console.log(`[measure] user-msg-save_ms=${Date.now() - tSave0}`);
      }).catch((e) => {
        console.warn("[measure] user-msg-save failed:", e instanceof Error ? e.message : String(e));
      })
    : Promise.resolve();
  void userSavePromise;

  // --- חתך מבני (דגל): תוכנית פעולות בקריאת מודל אחת. מבצעת עדכונים/סימולציה/
  //     השוואה בקוד, מציגה כרטיס מהתוצאה השמורה, ומחזירה תשובה - בלי הבנה כפולה. ---
  if (fastPathEnabled() && lastUser) {
    const userText = (lastUser.parts as Array<{ type: string; text?: string }>)
      .filter((p) => p.type === "text").map((p) => p.text).join(" ");
    const tA0 = Date.now();
    try {
      const fp = await runFastPlan(service, ctx.caseId, owner, state, userText, modelMessages);
      // חיווי מסלול בלוג (ללא תוכן אישי): אילו פעולות בוצעו ואם נדרשה קריאת-המשך.
      console.log(
        `[chat] path=A did=${Object.entries(fp.did).filter(([, v]) => v).map(([k]) => k).join(",") || "none"} followup=${fp.needsFollowup}`,
      );
      // תלוי-תוצאה: ממשיכים למודל עם התוצאה בפועל (לא מתחילים שוב את ההבנה).
      // זו קריאת-המשך קצרה שמנסחת הסבר מבוסס-תוצאה; הכרטיס כבר נשמר.
      const planMs = Date.now() - tA0;
      const reply = fp.needsFollowup
        ? await narrateResult(userText, fp.actionResults)
        : fp.reply;
      // מדידת תור (ללא מידע אישי): A עושה קריאת-תוכנית אחת + קריאת-ניסוח כשצריך.
      // card_ms מקורב ל-planMs כי הכרטיס נשמר במהלך ביצוע התוכנית.
      console.log(
        `[measure] path=A modelCalls=${fp.needsFollowup ? 2 : 1} ` +
        `card_ms=${fp.did.compared ? planMs : "-"} ttft_ms=${Date.now() - tA0} total_ms=${Date.now() - tA0}`,
      );
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
    } catch (e) {
      // כשל במסלול המהיר -> נופלים בבטחה למסלול הכלים המלא (הבנה מלאה).
      const m = e instanceof Error ? e.message : String(e);
      console.log(`[chat] path=A->B fallback (${m.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***").slice(0, 80)})`);
    }
  }

  try {
    console.log("[chat] path=B (full tool loop)");
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