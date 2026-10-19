// src/app/api/chat/route.ts
// נתיב streaming לשיחה. זהות (owner/case) מה-cookie בלבד - לעולם לא מהלקוח.
// משתמש ב-runtime (ששת הכלים + מודל). אין חישוב כאן; רק תזמור.
//
// שמירה = באחריות המערכת. הטקסט מוזרם ללקוח מיד; אחריו מתבצעת שמירה עם
// ניסיונות חוזרים אוטומטיים ומוגבלים (backoff) לאותן הודעות ואותם מזהים -
// בלי הפעלת מודל/חישוב/כלים מחדש. חיווי שקט בזמן התאוששות; רק אם כל
// הניסיונות נכשלו מסומן failed (אזהרה + ניסיון ידני כמוצא אחרון).
// consumeSseStream מבטיח שהשמירה תרוץ גם כשהלקוח מתנתק (ניתוק != קריסת שרת).

import { cookies } from "next/headers";
import {
  convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse,
  consumeStream, type UIMessage,
} from "ai";
import { caseService } from "../../../server/web/service.js";
import { getSessionUser } from "../../../server/auth/next-session.js";
import { streamChat, stripReasoning, type ChatBudgetState } from "../../../server/agent/chat-runtime.js";
import type { ToolContext } from "../../../server/agent/tool-contracts.js";
import { fastPathEnabled } from "../../../server/agent/model.js";
import { runFastPlan, narrateResult } from "../../../server/agent/fast-path.js";
import type { CaseService } from "../../../server/services/case-service.js";
import { saveTurnWithRetry, type SaveStatusData } from "../../../server/web/save-turn.js";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

// תקציב מצטבר לכל התהליך (אומדן, לא תקרת חיוב).
const budget: ChatBudgetState = { estimatedUsd: 0, calls: 0 };

// הודעות שגיאה ידידותיות למשתמש/ת (בלי ניסוח פנימי/טכני).
const ERR_FULL = "מצטער/ת, משהו השתבש בעיבוד התשובה. הנתונים שכבר נשמרו נשמרו. אפשר לנסות שוב בעוד רגע.";
const ERR_SUFFIX = "(ההמשך נקטע עקב תקלה זמנית. אפשר לנסות שוב.)";
function nlErr(): string { return "\n\n"; }

/** שמירת הודעת המשתמש בלבד (idempotent), כש-המודל נכשל לפני אירוע הסיום. */
async function saveUserMessage(
  service: CaseService, caseId: string, owner: string, lastUser: UIMessage,
): Promise<void> {
  await service.appendMessages(caseId, owner, [
    { role: "user", clientMessageId: lastUser.id, content: lastUser.parts },
  ]);
}


/** מנקה פרטים רגישים משגיאה לפני לוג/החזרה (חיבורי DB, מפתחות). */
function sanitizeError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m
    .replace(/postgres(ql)?:\/\/\S+/gi, "postgres://***")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(/AQ\.[A-Za-z0-9._-]{10,}/g, "AQ.***")
    .replace(/(key|token|password)[=:]\S+/gi, "$1=***")
    .slice(0, 200);
}

/**
 * עוטף את כל הטיפול: כשל לפני תחילת המסלול (פתיחת תיק, הגדרת שירות, dataset)
 * נרשם ללוג השרת ומוחזר כשגיאת JSON קריאה, במקום "Internal Server Error" כללי.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    return await handleChat(req);
  } catch (e) {
    const detail = sanitizeError(e);
    console.error(`[chat] unhandled ${e instanceof Error ? e.name : "Error"}: ${detail}`);
    return new Response(
      JSON.stringify({ error: "שגיאת שרת בשיחה.", code: e instanceof Error ? e.name : "Error", detail }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
}

async function handleChat(req: Request): Promise<Response> {
  // הבעלים = המשתמש המאומת (סשן Supabase), לעולם לא ערך מהלקוח או עוגיית ביקור.
  const user = await getSessionUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "auth_required" }), { status: 401, headers: { "content-type": "application/json" } });
  }
  const owner = user.id;
  const { messages }: { messages: UIMessage[] } = await req.json();
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
          // 2) שמירה עם ניסיונות חוזרים אוטומטיים (רק השמירה חוזרת; לא המודל).
          const saved = await saveTurnWithRetry(service, cid, owner, [
            { role: "user", clientMessageId: lastUser.id, content: lastUser.parts },
            { role: "assistant", clientMessageId: asstId, content: [{ type: "text", text: reply }] },
          ], (s) => writer.write({ type: "data-saveStatus", data: s }), "path=A");
          // 3) חיווי סופי: saved או failed (לא מבטיחים שמירה אם לא הצליחה).
          writer.write({ type: "data-saveStatus", data: { phase: saved ? "saved" : "failed", scope: "turn" } satisfies SaveStatusData });
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
        // ממתינים לסיום המודל. *סטטוס התשובה* (המודל) נפרד מ*סטטוס השמירה* (persistence):
        // כשל מודל אינו "שמירה שנכשלה", ולהפך. שומרים טקסט חלקי אם הגיע.
        let assistantText = "";
        let answerOk = true;
        try {
          assistantText = (await result.text) ?? "";
        } catch (e) {
          answerOk = false;
          console.warn(`[chat] path=B model stream failed: ${sanitizeError(e)}`);
        }
        // כשל מודל *או* תשובה ריקה -> הודעת שגיאה ברורה (לא תור ריק שקט).
        // טקסט חלקי שכבר הוזרם נשמר כפי שהוא; אם אין טקסט כלל, מזריקים הודעה.
        const hadText = assistantText.trim().length > 0;
        if (!answerOk || !hadText) {
          const errText = hadText
            ? assistantText + nlErr() + ERR_SUFFIX
            : ERR_FULL;
          if (!hadText) {
            // אין טקסט כלל -> כותבים הודעת שגיאה כחלק טקסט חדש (הממשק יציג אותה).
            const eid = "t-err-" + randomUUID();
            writer.write({ type: "text-start", id: eid });
            writer.write({ type: "text-delta", id: eid, delta: ERR_FULL });
            writer.write({ type: "text-end", id: eid });
          }
          assistantText = errText;
          writer.write({ type: "data-answerStatus", data: { phase: "error", scope: "turn" } });
        } else {
          writer.write({ type: "data-answerStatus", data: { phase: "ok", scope: "turn" } });
        }
        const aid = "asst-" + randomUUID();
        // שמירת הטקסט (כולל הודעת השגיאה אם זה המצב) - כדי שרענון יראה אותו.
        const saved = await saveTurnWithRetry(service, cid, owner, [
          ...(lastUser ? [{ role: "user" as const, clientMessageId: lastUser.id, content: lastUser.parts }] : []),
          { role: "assistant" as const, clientMessageId: aid, content: [{ type: "text", text: assistantText }] },
        ], (s) => writer.write({ type: "data-saveStatus", data: s }), "path=B");
        writer.write({ type: "data-saveStatus", data: { phase: saved ? "saved" : "failed", scope: "turn" } satisfies SaveStatusData });
        // סיום מצב ההמתנה תמיד (הצלחה או כשל).
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