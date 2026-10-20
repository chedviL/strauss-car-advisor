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
import { getFallbackChatModel, getFallbackChatModelId } from "../../../server/agent/model.js";
import { isQuotaError } from "../../../server/agent/payslip-extract.js";
import type { ToolContext } from "../../../server/agent/tool-contracts.js";
import { fastPathEnabled } from "../../../server/agent/model.js";
import { runFastPlan, narrateResult } from "../../../server/agent/fast-path.js";
import type { CaseService } from "../../../server/services/case-service.js";
import { saveTurnWithRetry, type SaveStatusData } from "../../../server/web/save-turn.js";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

// הודעות שגיאה ידידותיות למשתמש/ת (בלי ניסוח פנימי/טכני).
const ERR_FULL = "מצטער/ת, משהו השתבש בעיבוד התשובה. הנתונים שכבר נשמרו נשמרו. אפשר לנסות שוב בעוד רגע.";
const ERR_SUFFIX = "(ההמשך נקטע עקב תקלה זמנית. אפשר לנסות שוב.)";
const ERR_BOTH_BLOCKED = "השירות עמוס כרגע גם בגיבוי. הנתונים שנשמרו נשמרו. אפשר לנסות שוב בעוד מספר דקות.";

// cooldown חיוב ל-Claude: אחרי כשל חיוב, מדלגים על Claude ל-5 דקות (לכל מופע חם)
// כדי לא לנסות-ולהיכשל בכל הודעה. פג מעצמו (בדיקת התאוששות) ו-cold-start מאפס.
const CLAUDE_BILLING_COOLDOWN_MS = 5 * 60 * 1000;
let claudeBillingBlockedUntil = 0;
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
 * תיאור מפורט לשגיאת ספק ללוג (אבחון): קוד HTTP, שם/סוג, מזהה מודל אם קיים,
 * וקטע מגוף התגובה (מכיל פרטי מכסה/מודל). *אינו* מדפיס מפתחות - sanitizeError מסנן.
 * עובר על שרשרת ה-cause כדי לחשוף את ה-APICallError הגולמי מתחת לעטיפות ה-SDK.
 */
function describeProviderError(e: unknown): string {
  const out: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const o = cur as { name?: string; statusCode?: number; url?: string; responseBody?: unknown; data?: unknown; cause?: unknown; message?: string };
    const name = o?.name ?? "?";
    const sc = typeof o?.statusCode === "number" ? o.statusCode : "";
    const model = typeof o?.url === "string" ? (o.url.match(/models\/([^:?/]+)/)?.[1] ?? "") : "";
    let bodySnippet = "";
    const rb = o?.responseBody ?? o?.data;
    if (typeof rb === "string") bodySnippet = rb;
    else if (rb && typeof rb === "object") { try { bodySnippet = JSON.stringify(rb); } catch { /* ignore */ } }
    if (sc || bodySnippet || (name && name !== "?")) {
      out.push(`[L${i} name=${name}${sc ? " status=" + sc : ""}${model ? " model=" + model : ""}${bodySnippet ? " body=" + bodySnippet.slice(0, 220) : ""}]`);
    }
    cur = o?.cause;
  }
  const joined = out.join(" ");
  // סינון מפתחות/סודות ליתר ביטחון (key=..., sk-..., AIza... של Google).
  return joined.replace(/key[=:]\S+/gi, "key=***").replace(/AIza[0-9A-Za-z_-]{10,}/g, "AIza***").slice(0, 500) || sanitizeError(e);
}

/** כשל ספק זמני שמצדיק גיבוי: 5xx/overloaded/timeout/unavailable. לא שגיאת קוד/כלי. */
function isProviderUnavailable(e: unknown): boolean {
  let cur: unknown = e; const parts: string[] = [];
  for (let i = 0; i < 4 && cur; i++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      const sc = (cur as { statusCode?: number }).statusCode;
      if (sc && sc >= 500) return true;
      cur = (cur as { cause?: unknown }).cause;
    } else { parts.push(String(cur)); break; }
  }
  return /overloaded|unavailable|503|502|500|timeout|timed out|ETIMEDOUT|ECONNRESET|service is temporarily/i.test(parts.join(" "));
}

/** כשל חיוב/יתרה של ספק (למשל Anthropic 'credit balance is too low', 400/402/403):
 * כשל ספק שמצדיק גיבוי, *לא* שגיאת קוד. מזוהה לפי הודעה, כי קוד הסטטוס אינו 429. */
function isProviderBilling(e: unknown): boolean {
  let cur: unknown = e; const parts: string[] = [];
  for (let i = 0; i < 4 && cur; i++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      const rb = (cur as { responseBody?: unknown }).responseBody;
      if (typeof rb === "string") parts.push(rb);
      cur = (cur as { cause?: unknown }).cause;
    } else { parts.push(String(cur)); break; }
  }
  return /credit balance is too low|plans ?& ?billing|insufficient (credit|quota|balance|funds)|billing|payment required|402/i.test(parts.join(" "));
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
    const rid = randomUUID().slice(0, 8);
    console.error(`[chat] reqId=${rid} unhandled(pre-stream) ${e instanceof Error ? e.name : "Error"}: ${detail}`);
    return new Response(
      JSON.stringify({ error: "שגיאת שרת בשיחה.", code: e instanceof Error ? e.name : "Error", detail, reqId: rid }),
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
  const reqId = randomUUID().slice(0, 8); // מזהה קצר לקורלציה בין הדפדפן ללוגי השרת
  // תקציב *לכל בקשה* (לא מצטבר על פני מופע חם): מונע נעילה קבועה של השיחה
  // כשסכום האומדן על המופע חוצה תקרה. תור בודד עדיין חסום ע"י maxSteps/maxOutputTokens.
  const budget: ChatBudgetState = { estimatedUsd: 0, calls: 0 };
  const body = (await req.json()) as { messages: UIMessage[]; caseId?: string };
  const messages = body.messages;
  const store = await cookies();
  const service = caseService();
  // הבירור הפעיל: מזהה מפורש מהלקוח (מה-URL ?c=) קודם - *מאומת בעלות בשרת* (מזהה
  // מהלקוח אינו הרשאה: תיק שאינו של המשתמש -> לא נמצא, וייפתח חדש). עוגייה היא
  // גיבוי תאימות בלבד. אין fallback שמחבר הודעה חדשה לתיק ישן של מסך נקי.
  const reqCaseId = typeof body.caseId === "string" && /^[0-9a-f-]{36}$/i.test(body.caseId) ? body.caseId : null;
  let caseId = reqCaseId;
  let state = caseId ? await service.getCaseState(caseId, owner) : null;
  if (!state) {
    const created = await service.startBlankCase(owner);
    caseId = created.case.id;
    state = created;
  }
  // סנכרון עוגייה למצב הפעיל (ל-payslip/תאימות). לא מקור ההרשאה.
  store.set("strauss_case", caseId!, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
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
          writer.write({ type: "data-activeCase", data: { caseId: cid, scope: "turn" } });
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
    console.log(`[chat] reqId=${reqId} path=B (full tool loop)`);
    // גשר לאירוע הכרטיס: onComparisonReady נורה בתוך הרַצת המודל (onStepFinish),
    // שעשוי לקרות לפני שה-writer קיים. מחזיקים דגל/פונקציה ומשדרים ברגע שאפשר.
    let emitCard: (() => void) | null = null;
    let cardPending = false;
    let cardSent = false;
    const fireCard = () => { if (cardSent) return; if (emitCard) { cardSent = true; emitCard(); } else { cardPending = true; } };
    // מעקב אם רצה פעולה/כלי (כתיבה/פנייה) - גיבוי מותר *רק* אם כלום עדיין לא בוצע,
    // כדי לא לשכפל כתיבות/פניות. provider error בלבד מפעיל גיבוי - לא שגיאת קוד/כלי/מסד.
    let toolRan = false;
    let primaryError: unknown = null;
    let firstChunk = false;
    // cooldown חיוב: אם Claude נחסם בחיוב לאחרונה, מדלגים עליו ישירות לגיבוי כדי
    // לא לנסות-ולהיכשל בכל הודעה. פג אחרי CLAUDE_BILLING_COOLDOWN_MS (בדיקת התאוששות).
    const claudeBlocked = Date.now() < claudeBillingBlockedUntil;
    let resolveFirst: (() => void) | null = null;
    const firstOrError = new Promise<void>((res) => { resolveFirst = res; });
    const result = claudeBlocked ? null : streamChat({
      service, ctx, state, messages: modelMessages, budget,
      onComparisonReady: fireCard,
      onToolCalled: () => { toolRan = true; },
      onFirstChunk: () => { firstChunk = true; resolveFirst?.(); },
      onProviderError: (pe) => { if (!primaryError) primaryError = pe; resolveFirst?.(); },
    });
    if (result) void Promise.resolve(result.consumeStream()).catch((err) => { if (!primaryError) primaryError = err; resolveFirst?.(); });
    else console.log(`[chat] reqId=${reqId} skipping claude (billing cooldown active) -> fallback`);

    const stream = createUIMessageStream({
      originalMessages: messages,
      onError: (err) => {
        console.error(`[chat] reqId=${reqId} stream-error name=${err instanceof Error ? err.name : "Error"} detail=${sanitizeError(err)}`);
        return ERR_FULL;
      },
      execute: async ({ writer }) => {
        writer.write({ type: "start" });
        writer.write({ type: "data-activeCase", data: { caseId: cid, scope: "turn" } });
        emitCard = () => writer.write({ type: "data-comparison", data: { ready: true, scope: "turn" } });
        if (cardPending && !cardSent) { cardSent = true; emitCard(); }
        let assistantText = "";
        let answerOk = false;
        let fellBack = false;
        // (1) מריצים את ה-primary (אם לא ב-cooldown) ו*מחכים לאות ראשון*: פלט אמיתי
        // (text/tool) או שגיאת ספק. כך זורם חי כשיש פלט, אך נמנעים מלמזג זרם שנכשל.
        if (result) {
          await firstOrError;
          if (firstChunk) {
            // המודל התחיל להחזיר -> מזרימים חי (ללא רגרסיית streaming). שגיאה
            // *אחרי* פלט חלקי -> לא מתחילים תור מחדש; מוצג כשל שניתן להתאוששות.
            writer.merge(result.toUIMessageStream({ sendFinish: false, sendStart: false }));
            try { assistantText = (await result.text) ?? ""; answerOk = assistantText.trim().length > 0; }
            catch (e) { console.warn(`[chat] reqId=${reqId} path=B mid-stream fail after output (no restart): ${sanitizeError(primaryError ?? e)}`); answerOk = assistantText.trim().length > 0; }
            if (cardPending && !cardSent) { cardSent = true; emitCard!(); }
          }
        }
        // (2) כשל מוקדם (לפני פלט/כלי) *או* cooldown -> ניסיון גיבוי אחד, לפני כל פלט.
        if (!firstChunk && !answerOk) {
          const perr = primaryError;
          const providerFail = claudeBlocked || isQuotaError(perr) || isProviderUnavailable(perr) || isProviderBilling(perr);
          if (isProviderBilling(perr)) { claudeBillingBlockedUntil = Date.now() + CLAUDE_BILLING_COOLDOWN_MS; }
          console.warn(`[chat] reqId=${reqId} path=B early-fail providerFail=${providerFail} claudeBlocked=${claudeBlocked} toolRan=${toolRan}: ${describeProviderError(perr)}`);
          const fb = (providerFail && !toolRan) ? getFallbackChatModel() : null;
          if (fb) {
            console.log(`[chat] reqId=${reqId} path=B fallback -> ${getFallbackChatModelId()} (one attempt)`);
            // אותה משמעת כמו ה-primary: *לא ממזגים את זרם הגיבוי לפני אות ראשון*,
            // כדי שגם כשל גיבוי (מכסה/שגיאה) לא יפלוט error part ללקוח.
            fellBack = true;
            let fbFirst = false; let fbError: unknown = null;
            let resolveFb: (() => void) | null = null;
            const fbFirstOrError = new Promise<void>((res) => { resolveFb = res; });
            const fbRes = streamChat({ service, ctx, state, messages: modelMessages, budget: { estimatedUsd: 0, calls: 0 }, model: fb, onComparisonReady: fireCard, onToolCalled: () => { toolRan = true; }, onFirstChunk: () => { fbFirst = true; resolveFb?.(); }, onProviderError: (pe) => { if (!fbError) fbError = pe; resolveFb?.(); } });
            void Promise.resolve(fbRes.consumeStream()).catch((e) => { if (!fbError) fbError = e; resolveFb?.(); });
            await fbFirstOrError;
            if (fbFirst) {
              writer.merge(fbRes.toUIMessageStream({ sendFinish: false, sendStart: false }));
              try { assistantText = (await fbRes.text) ?? ""; } catch { /* mid-stream fail after output */ }
              answerOk = assistantText.trim().length > 0;
              if (cardPending && !cardSent) { cardSent = true; emitCard!(); }
            } else {
              console.warn(`[chat] reqId=${reqId} path=B fallback(gemini=${getFallbackChatModelId()}) failed before output: ${describeProviderError(fbError)}`);
            }
          }
        }
        const hadText = assistantText.trim().length > 0;
        if (!answerOk || !hadText) {
          // אם גם הגיבוי נוצל/חסום - הודעה ברורה שמסיימת את ההמתנה, בלי ניסיון נוסף.
          const baseErr = fellBack ? ERR_BOTH_BLOCKED : ERR_FULL;
          const errText = hadText
            ? assistantText + nlErr() + ERR_SUFFIX
            : baseErr;
          if (!hadText) {
            // אין טקסט כלל -> כותבים הודעת שגיאה כחלק טקסט חדש (הממשק יציג אותה).
            const eid = "t-err-" + randomUUID();
            writer.write({ type: "text-start", id: eid });
            writer.write({ type: "text-delta", id: eid, delta: baseErr });
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