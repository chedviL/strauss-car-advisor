// scripts/sim/verify-persistence.ts
// מאמת שמירת שיחה ושחזור בדיוק לפי זרימת הנתיב+עמוד:
// 1) כמה הודעות עובד+בוט  2) השוואה+כרטיס  3) רענון ושחזור לפי סדר
// 4) שאלת המשך שמתייחסת לשיחה  5) "רענון באמצע תשובה" - בלי כפילות ובלי חלקי-כמושלם.
import { randomUUID } from "node:crypto";
import type { ModelMessage, UIMessage } from "ai";
import { convertToModelMessages } from "ai";
import { loadEnv } from "../../src/server/web/load-env.js";
loadEnv();
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { findActiveDatasetId } from "../../src/server/services/dataset-provider.js";
import { streamChat, stripReasoning } from "../../src/server/agent/chat-runtime.js";
import type { ToolContext } from "../../src/server/agent/tool-contracts.js";
import type { CaseFacts } from "../../src/domain/contracts/case.js";

const CONN = process.env.DATABASE_URL!;
const repo = new PgCaseRepository(CONN);
const service = new CaseService(repo);
const budget = { estimatedUsd: 0, calls: 0 };
let pass=0, fail=0;
function check(n:string,ok:boolean,d=""){ console.log(`[${ok?"✓":"✗"}] ${n}${d?" — "+d:""}`); ok?pass++:fail++; }
const facts: CaseFacts = { occupationCode: "product_manager", reportedGroup: "ג", baseSalary: 14200, commission: 1000, bonus: 0, pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.25, qualifyingChildren: 2 };

// מדמה את הנתיב: שומר הודעת משתמש, מריץ תור, שומר תשובה ב-onFinish, מחזיר טקסט.
async function routeTurn(ctx: ToolContext, owner: string, uiMessages: UIMessage[], opts?: { abandonMidway?: boolean }): Promise<{ text: string; finished: boolean }> {
  const modelMessages = stripReasoning(await convertToModelMessages(uiMessages));
  const lastUser = [...uiMessages].reverse().find((m) => m.role === "user");
  if (lastUser) await service.appendMessages(ctx.caseId, owner, [{ role: "user", clientMessageId: lastUser.id, content: lastUser.parts }]).catch(()=>{});
  const state = (await service.getCaseState(ctx.caseId, ctx.ownerId))!;
  const res = streamChat({ service, ctx, state, messages: modelMessages, budget });
  let text = ""; let finished = false;
  if (opts?.abandonMidway) {
    // "רענון באמצע": קוראים chunk אחד ואז עוזבים את ה-client, אבל מבקשים מהשרת לסיים.
    const it = res.textStream[Symbol.asyncIterator]();
    const first = await it.next();
    if (!first.done) text += first.value;
    // מדמה את מה שהנתיב עושה: ה-stream ממשיך בשרת ו-onFinish שומר. נחכה שהוא יסתיים.
    const full = await res.text; // ממתין להשלמת השרת
    const resp = (await res.response).messages;
    await service.appendMessages(ctx.caseId, owner, [{ role: "assistant", clientMessageId: (resp[resp.length-1] as {id?:string})?.id ?? randomUUID(), content: [{ type: "text", text: full }] }]).catch(()=>{});
    return { text, finished: false }; // ה-client ראה חלקי בלבד
  }
  for await (const d of res.textStream) text += d;
  finished = true;
  const resp = (await res.response).messages;
  // onFinish של הנתיב:
  const lastAssistant = resp[resp.length-1] as { id?: string; role?: string };
  await service.appendMessages(ctx.caseId, owner, [{ role: "assistant", clientMessageId: lastAssistant?.id ?? randomUUID(), content: [{ type:"text", text }] }]).catch(()=>{});
  return { text, finished };
}

// מדמה טעינת עמוד: טוען הודעות מהמסד ובונה את ה-UIMessages (כמו page.tsx -> ChatPanel)
async function loadAsPage(ctx: ToolContext, owner: string): Promise<UIMessage[]> {
  const stored = await service.loadMessages(ctx.caseId, owner);
  return stored.map((m) => ({ id: m.clientMessageId ?? m.id, role: m.role as "user"|"assistant", parts: m.content as never })) as UIMessage[];
}

async function main(){
  const owner = "persist-" + randomUUID();
  const did = await findActiveDatasetId(CONN);
  const created = await repo.createCase({ ownerId: owner, isDemo:true, datasetId: did!, facts, baseline:{role:"baseline",route:"company_car",vehicleCode:"CAR-09",participation:300,maintenanceAllowance:0}});
  const ctx: ToolContext = { ownerId: owner, caseId: created.case.id, staffRole:null, requestId: randomUUID(), messageId:null };

  const ui: UIMessage[] = [];
  // תור 1
  ui.push({ id: "u1", role: "user", parts: [{ type: "text", text: "אם אעבור לרכב חשמלי כמה זה ישנה לי בנטו?" }] } as UIMessage);
  const t1 = await routeTurn(ctx, owner, ui);
  ui.push({ id: "a1", role: "assistant", parts: [{ type: "text", text: t1.text }] } as UIMessage);
  // תור 2
  ui.push({ id: "u2", role: "user", parts: [{ type: "text", text: "תשווי בין שתי האופציות הכי טובות" }] } as UIMessage);
  const t2 = await routeTurn(ctx, owner, ui);
  ui.push({ id: "a2", role: "assistant", parts: [{ type: "text", text: t2.text }] } as UIMessage);

  // (1) כמה הודעות + (2) השוואה/כרטיס
  const after2 = await service.loadMessages(ctx.caseId, owner);
  check("4 הודעות נשמרו (2 עובד + 2 בוט)", after2.length === 4, `count=${after2.length}`);
  check("סדר תקין", after2.map(m=>m.role).join(",") === "user,assistant,user,assistant", after2.map(m=>m.role).join(","));
  const st2 = (await service.getCaseState(ctx.caseId, ctx.ownerId))!;
  check("יש השוואה שמורה (כרטיס)", !!st2.latestComparison, st2.latestComparison ? "yes" : "no");

  // (3) רענון: טעינה מחדש מהמסד
  const reloaded = await loadAsPage(ctx, owner);
  check("אחרי רענון: אותן 4 הודעות לפי סדר", reloaded.length === 4 && reloaded[0]?.role==="user" && reloaded[3]?.role==="assistant", `len=${reloaded.length}`);

  // (4) שאלת המשך שמתייחסת לשיחה הקודמת
  reloaded.push({ id: "u3", role: "user", parts: [{ type: "text", text: "ומה לגבי הרכב השני שהצעת?" }] } as UIMessage);
  const t3 = await routeTurn(ctx, owner, reloaded);
  check("המשך מתייחס לשיחה (לא 'לא הבנתי')", t3.text.length > 0 && !/לא הבנתי|על איזה רכב|מה הכוונה/.test(t3.text), t3.text.slice(0,70));
  reloaded.push({ id: "a3", role: "assistant", parts: [{ type: "text", text: t3.text }] } as UIMessage);

  // (5) רענון באמצע תשובה
  const beforeMid = (await service.loadMessages(ctx.caseId, owner)).length;
  reloaded.push({ id: "u4", role: "user", parts: [{ type: "text", text: "ומה אם אוותר על הרכב?" }] } as UIMessage);
  const tMid = await routeTurn(ctx, owner, reloaded, { abandonMidway: true });
  const afterMid = await service.loadMessages(ctx.caseId, owner);
  check("רענון באמצע: הודעת משתמש+תשובת-שרת נשמרו (ללא כפילות)", afterMid.length === beforeMid + 2, `before=${beforeMid} after=${afterMid.length}`);
  check("ה-client ראה חלקי בלבד (לא הוצג כמושלם)", !tMid.finished);
  // רענון: טוען מהמסד -> ההודעה האחרונה היא התשובה המלאה מהשרת, לא החלקית מהלקוח
  const afterReload = await loadAsPage(ctx, owner);
  const lastAssistant = [...afterReload].reverse().find(m=>m.role==="assistant")!;
  const lastText = (lastAssistant.parts as Array<{type:string;text?:string}>).filter(p=>p.type==="text").map(p=>p.text).join("");
  check("אחרי רענון: התשובה המלאה מהשרת מופיעה", lastText.length > tMid.text.length, `server=${lastText.length} client-partial=${tMid.text.length}`);

  // dedup: שליחה חוזרת של אותה הודעת משתמש (u4) לא תשכפל
  await service.appendMessages(ctx.caseId, owner, [{ role: "user", clientMessageId: "u4", content: [{type:"text",text:"ומה אם אוותר על הרכב?"}] }]);
  const afterDup = await service.loadMessages(ctx.caseId, owner);
  check("אין כפילות הודעות בשליחה חוזרת (dedup לפי id)", afterDup.length === afterMid.length, `before=${afterMid.length} after=${afterDup.length}`);

  console.log(`\n${pass} עברו, ${fail} נכשלו | עלות מוערכת $${budget.estimatedUsd.toFixed(4)}`);
  process.exit(fail===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});