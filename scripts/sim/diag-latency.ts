// scripts/sim/diag-latency.ts
// אבחון זמן תור מלא דרך לוגיקת הנתיב. מפרק: טעינת תיק/הקשר, המתנה למודל,
// תחילת טקסט (TTFT), סיום, מספר קריאות מודל/כלים, זמן DB. כולל השוואת
// בקשת API מינימלית מול בקשת הצ'אט המלאה (ספק מול הקשר/תזמור).
import { randomUUID } from "node:crypto";
import type { ModelMessage } from "ai";
import { stepCountIs, streamText, tool, generateText } from "ai";
import { loadEnv } from "../../src/server/web/load-env.js";
loadEnv();
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { findActiveDatasetId } from "../../src/server/services/dataset-provider.js";
import { stripReasoning } from "../../src/server/agent/chat-runtime.js";
import { buildContext } from "../../src/server/agent/context.js";
import { getModel, getEffort, getModelId, BUDGET } from "../../src/server/agent/model.js";
import { readCaseStateInput, readCaseState } from "../../src/server/agent/tools/read-case-state.js";
import { updateCaseInput, updateCase } from "../../src/server/agent/tools/update-case.js";
import { manageScenariosInput, manageScenarios } from "../../src/server/agent/tools/manage-scenarios.js";
import { searchVehiclesInput, searchVehicles } from "../../src/server/agent/tools/search-vehicles.js";
import { compareScenariosInput, compareScenarios } from "../../src/server/agent/tools/compare-scenarios.js";
import { openInquiryInput, openInquiry } from "../../src/server/agent/tools/open-inquiry.js";
import { readComparisonInput, readComparison } from "../../src/server/agent/tools/read-comparison.js";
import type { ToolContext } from "../../src/server/agent/tool-contracts.js";

const CONN = process.env.DATABASE_URL!;
const repo = new PgCaseRepository(CONN);
const service = new CaseService(repo);
const budget = { estimatedUsd: 0, calls: 0 };

function tools(ctx: ToolContext){ return {
  readCaseState: tool({ description:"", inputSchema: readCaseStateInput, execute:(i)=>readCaseState(service,ctx,i)}),
  updateCase: tool({ description:"", inputSchema: updateCaseInput, execute:(i)=>updateCase(service,ctx,i)}),
  manageScenarios: tool({ description:"", inputSchema: manageScenariosInput, execute:(i)=>manageScenarios(service,ctx,i)}),
  searchVehicles: tool({ description:"", inputSchema: searchVehiclesInput, execute:(i)=>searchVehicles(service,ctx,i)}),
  compareScenarios: tool({ description:"", inputSchema: compareScenariosInput, execute:(i)=>compareScenarios(service,ctx,i)}),
  openInquiry: tool({ description:"", inputSchema: openInquiryInput, execute:(i)=>openInquiry(service,ctx,i)}),
  readComparison: tool({ description:"", inputSchema: readComparisonInput, execute:(i)=>readComparison(service,ctx,i)}),
};}

async function fullTurn(label: string, ctx: ToolContext, msgs: ModelMessage[], text: string){
  console.log(`\n===== ${label}: "${text}" =====`);
  msgs.push({ role:"user", content:text });
  const tStart = Date.now();
  // 1) טעינת מצב+הקשר
  const tLoad0 = Date.now();
  const state = (await service.getCaseState(ctx.caseId, ctx.ownerId))!;
  const context = buildContext(state);
  const tLoad = Date.now() - tLoad0;
  // 2) המתנה למודל + streaming
  let ttft = 0; let steps = 0; const stepInfo: string[] = [];
  const tModel0 = Date.now();
  const res = streamText({
    model: getModel(),
    system: "ctx:\n" + context,
    messages: msgs,
    tools: tools(ctx),
    stopWhen: stepCountIs(BUDGET.maxSteps),
    maxOutputTokens: BUDGET.maxOutputTokens,
    providerOptions: { anthropic: { disableParallelToolUse: true, effort: getEffort() } },
    onStepFinish: (s) => { steps++; const names=(s.toolCalls??[]).map(c=>c.toolName).join("+")||"(text)"; stepInfo.push(`      step ${steps}: ${names} in=${s.usage?.inputTokens} out=${s.usage?.outputTokens} reason=${s.usage?.outputTokenDetails?.reasoningTokens ?? 0} @${Date.now()-tModel0}ms`); },
  });
  let out=""; for await (const d of res.textStream){ if(!ttft) ttft=Date.now()-tModel0; out+=d; }
  const tModel = Date.now() - tModel0;
  const total = Date.now() - tStart;
  const tools_used = (await res.toolCalls).map(c=>c.toolName);
  msgs.push(...(await res.response).messages);
  const cleaned = stripReasoning(msgs); msgs.length=0; msgs.push(...cleaned);
  console.log(`  טעינת מצב+הקשר: ${tLoad}ms`);
  console.log(`  המתנה למודל עד תחילת טקסט (TTFT): ${ttft}ms`);
  console.log(`  סיום תשובת מודל: ${tModel}ms`);
  console.log(`  סה"כ תור: ${total}ms`);
  console.log(`  קריאות מודל (steps)=${steps} | כלים=${tools_used.join(",")||"(ללא)"}`);
  stepInfo.forEach(l=>console.log(l));
}

async function main(){
  console.log(`מודל=${getModelId()} effort=${getEffort()}`);
  const owner = "diag-" + randomUUID();
  const did = await findActiveDatasetId(CONN);
  const created = await service.startBlankCase(owner);
  const ctx: ToolContext = { ownerId: owner, caseId: created.case.id, staffRole:null, requestId: randomUUID(), messageId:null };

  // (3) בקשת API מינימלית מול אותו מודל - למדוד השהיית ספק טהורה
  console.log("\n--- בקשת API מינימלית (ללא כלים/הקשר) ---");
  const tMin0 = Date.now();
  const mini = await generateText({ model: getModel(), prompt: "אמור שלום במילה אחת.", maxOutputTokens: 32, providerOptions: { anthropic: { effort: getEffort() } } });
  console.log(`  מינימלי: ${Date.now()-tMin0}ms (out="${mini.text.trim()}")`);

  const msgs: ModelMessage[] = [];
  // הודעה ראשונה בתהליך - "היי" (ברכה, לא נדרשים כלים)
  await fullTurn("הודעה ראשונה (ברכה)", ctx, msgs, "היי");
  // הודעה שנייה באותו תהליך
  await fullTurn("הודעה שנייה (איסוף)", ctx, msgs, "השכר שלי 18,500");
  // הודעה ראשונה מסוג כוונה אמיתית (תיק חדש)
  const owner2 = "diag2-" + randomUUID();
  const created2 = await service.startBlankCase(owner2);
  const ctx2: ToolContext = { ownerId: owner2, caseId: created2.case.id, staffRole:null, requestId: randomUUID(), messageId:null };
  await fullTurn("תיק חדש - כוונה אמיתית", ctx2, [], "אני רוצה לבדוק מעבר לרכב חשמלי");
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});