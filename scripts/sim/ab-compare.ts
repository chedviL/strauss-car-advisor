// scripts/sim/ab-compare.ts — השוואה מבוקרת A (תוכנית מובנית) מול B (שיחה+כלים).
// אותו מודל/effort/הקשר/עובדות/שירותים/שמירה. מודד לכל תור. הרצה: --run=A|B --go
// הגנת תקציב: עוצר אם הצריכה המוערכת עוברת סף.
import { randomUUID } from "node:crypto";
import type { ModelMessage, UIMessage } from "ai";
import { convertToModelMessages } from "ai";
import { writeFileSync, appendFileSync } from "node:fs";
import { loadEnv } from "../../src/server/web/load-env.js";
loadEnv();
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { streamChat, stripReasoning } from "../../src/server/agent/chat-runtime.js";
import { runFastPlan, narrateResult } from "../../src/server/agent/fast-path.js";
import { getPool } from "../../src/server/repositories/pg-pool.js";
import { getModelId, getEffort } from "../../src/server/agent/model.js";
import type { ToolContext } from "../../src/server/agent/tool-contracts.js";

const PATH = (process.argv.find((a) => a.startsWith("--run="))?.split("=")[1] ?? "A") as "A" | "B";
const GO = process.argv.includes("--go");
const CONN = process.env.DATABASE_URL!;
const OUT = `ab-${PATH}.txt`; writeFileSync(OUT, "");
const log = (s: string) => appendFileSync(OUT, s + "\n");
const repo = new PgCaseRepository(CONN); const service = new CaseService(repo);
const budget = { estimatedUsd: 0, calls: 0 };
let dbCalls = 0;
function instrument(){ const p=getPool(CONN); const oc=p.connect.bind(p); (p as unknown as {connect:()=>Promise<unknown>}).connect=async()=>{ const c=(await oc()) as {query:(...a:unknown[])=>Promise<unknown>;_w?:boolean}; if(!c._w){c._w=true;const oq=c.query.bind(c);c.query=async(...a:unknown[])=>{dbCalls++;return oq(...a);};} return c as unknown; }; }
instrument();

// שתי שיחות בדיקה (קצרות). לא מוזרקות לפרומפט.
const CONVERSATIONS: Array<{ id: string; turns: string[] }> = [
  { id: "1-name-then-info", turns: ["אני חדוי", "אני שייכת לקבוצה ג ויש לי Atto 3"] },
  { id: "2-clear-goal", turns: ["אני רוצה לדעת אם כדאי לי לוותר על הרכב"] },
  { id: "3-detail-then-question", turns: ["אני מרוויחה 15,000 ויש לי קורולה קרוס", "רגע, כמה נקודות זיכוי יש לי?", "אז מה עם מעבר לחשמלי?"] },
  { id: "4-correct-vs-sim", turns: ["בעצם השכר שלי 16,000", "ומה אם הבונוס יהיה 3,000?"] },
  { id: "5-correct-and-compare", turns: ["תקני את השכר ל-19,000 ותשווי לי חשמליים"] },
  { id: "6-search-detail-inquiry", turns: ["אילו רכבים חשמליים יש?", "למה הראשון הכי טוב?", "לא יודעת מה ההשתתפות שלי, אפשר לברר?"] },
];

async function freshCase(): Promise<ToolContext> {
  const owner = "ab-" + randomUUID();
  const created = await service.startBlankCase(owner);
  return { ownerId: owner, caseId: created.case.id, staffRole: null, requestId: randomUUID(), messageId: null };
}

// מסלול A: תוכנית מובנית (כמו route כש-fast on)
async function turnA(ctx: ToolContext, _msgs: ModelMessage[], text: string){
  const d0=dbCalls; const t0=Date.now();
  const state=(await service.getCaseState(ctx.caseId,ctx.ownerId))!;
  const fp=await runFastPlan(service,ctx.caseId,ctx.ownerId,state,text);
  let modelCalls=1; let reply=fp.reply;
  const tText=Date.now()-t0; // טקסט ראשוני (תוכנית) מוכן
  if(fp.needsFollowup){ reply=await narrateResult(text,fp.actionResults); modelCalls=2; }
  const total=Date.now()-t0;
  const st=(await service.getCaseState(ctx.caseId,ctx.ownerId))!;
  const card=!!st.latestComparison;
  return { modelCalls, db:dbCalls-d0, tText, total, card, reply, did:fp.did };
}

// מסלול B: שיחה טבעית + כלים (כמו route כש-fast off), דרך streamText
async function turnB(ctx: ToolContext, msgs: ModelMessage[], text: string){
  const d0=dbCalls; const t0=Date.now();
  msgs.push({role:"user",content:text});
  const state=(await service.getCaseState(ctx.caseId,ctx.ownerId))!;
  const res=streamChat({service,ctx,state,messages:msgs,budget});
  let ttft=0; let out=""; for await(const dd of res.textStream){ if(!ttft)ttft=Date.now()-t0; out+=dd; }
  const total=Date.now()-t0; const tc=await res.toolCalls;
  msgs.push(...(await res.response).messages); const cl=stripReasoning(msgs); msgs.length=0; msgs.push(...cl);
  const st=(await service.getCaseState(ctx.caseId,ctx.ownerId))!;
  return { modelCalls: tc.length>0?tc.length+1:1, db:dbCalls-d0, tText:ttft, total, card:!!st.latestComparison, reply:out, tools:tc.map(c=>c.toolName) };
}

async function main(){
  if(!GO){ log("DRY RUN - הוסף --go להרצה בתשלום. (אין ריצת מודל ללא --go.)"); process.exit(0); }
  log(`=== PATH ${PATH} | model=${getModelId()} effort=${getEffort()} ===`);
  for(const conv of CONVERSATIONS){
    log(`\n## שיחה ${conv.id}`);
    const ctx=await freshCase(); const msgs:ModelMessage[]=[];
    for(const [i,text] of conv.turns.entries()){
      const r = PATH==="A" ? await turnA(ctx,msgs,text) : await turnB(ctx,msgs,text);
      log(`תור ${i+1} "${text}": calls=${r.modelCalls} db=${r.db} tText=${r.tText}ms total=${r.total}ms card=${r.card}`);
      log(`   reply: ${r.reply.replace(/\n/g," ").slice(0,160)}`);
      if(budget.estimatedUsd>0.45){ log("** עצירת תקציב **"); process.exit(0); }
    }
    const st=(await service.getCaseState(ctx.caseId,ctx.ownerId))!;
    log(`   מצב סופי: שכר=${st.facts.baseSalary} קבוצה=${st.facts.reportedGroup} baseline-רכב=${st.scenarios.find(s=>s.role==="baseline")?.vehicleCode} פניות=${st.openInquiries.length}`);
  }
  log(`\nצריכה מוערכת (B בלבד נמדד דרך budget): $${budget.estimatedUsd.toFixed(4)}`);
  process.exit(0);
}
main().catch(e=>{appendFileSync(OUT,"ERR "+(e instanceof Error?e.stack??e.message:String(e))+"\n");process.exit(1);});