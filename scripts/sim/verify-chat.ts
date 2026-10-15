// scripts/sim/verify-chat.ts
// אימות runtime מקצה-לקצה: מודל אמיתי + ששת הכלים + Postgres, בעברית.
// יוצר תיק אמיתי, שולח הודעה, ומדווח קריאות כלים, טקסט סופי, זמנים ועלות מוערכת.
// לא מדפיס סודות. הרצה: tsx scripts/sim/verify-chat.ts --sim

import { randomUUID } from "node:crypto";
import type { ModelMessage } from "ai";
import { loadEnv } from "../../src/server/web/load-env.js";
loadEnv();
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { findActiveDatasetId } from "../../src/server/services/dataset-provider.js";
import { streamChat, stripReasoning, getModelId, type ChatBudgetState } from "../../src/server/agent/chat-runtime.js";
import type { ToolContext } from "../../src/server/agent/tool-contracts.js";
import type { CaseFacts } from "../../src/domain/contracts/case.js";

if (!(process.env.SIM_MODE === "1" || process.argv.includes("--sim"))) { console.error("dev only"); process.exit(1); }
const CONN = process.env.DATABASE_URL!;
function redact(s: string): string { return s.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***"); }

async function turn(label: string, service: CaseService, ctx: ToolContext, messages: ModelMessage[], budget: ChatBudgetState): Promise<void> {
  const state = (await service.getCaseState(ctx.caseId, ctx.ownerId))!;
  const t = Date.now();
  const res = streamChat({ service, ctx, state, messages, budget });
  let text = "";
  for await (const d of res.textStream) text += d;
  const toolCalls = await res.toolCalls;
  const steps = await res.steps;
  console.log(`\n=== ${label} === (${Date.now() - t}ms)`);
  console.log("כלים שנקראו:", toolCalls.map((c) => c.toolName).join(", ") || "(ללא)");
  console.log("צעדים:", steps.length);
  console.log("תשובת המודל:", text.trim().slice(0, 400));
  // מוסיפים את תשובת העוזר להיסטוריה
  const respMsgs = (await res.response).messages;
  messages.push(...respMsgs);
  // מסירים reasoning מההיסטוריה לפני התור הבא (binding של thinking).
  const cleaned = stripReasoning(messages);
  messages.length = 0;
  messages.push(...cleaned);
}

async function main(): Promise<void> {
  console.log("מודל:", getModelId());
  const repo = new PgCaseRepository(CONN);
  const service = new CaseService(repo);
  const OWNER = "chat-" + randomUUID();
  const datasetId = await findActiveDatasetId(CONN);
  const facts: CaseFacts = { occupationCode: "product_manager", reportedGroup: "ג", baseSalary: 14200, commission: 1000, bonus: 0, pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.25, qualifyingChildren: 2 };
  const created = await service.createDemoCaseFromEmployee(OWNER, "E-001", datasetId ?? undefined).catch(async () => {
    return repo.createCase({ ownerId: OWNER, isDemo: true, datasetId: datasetId!, facts, baseline: { role: "baseline", route: "company_car", vehicleCode: "CAR-09", participation: 300, maintenanceAllowance: 0 } });
  });
  const ctx: ToolContext = { ownerId: OWNER, caseId: created.case.id, staffRole: null, requestId: randomUUID(), messageId: null };
  const budget: ChatBudgetState = { estimatedUsd: 0, calls: 0 };
  const messages: ModelMessage[] = [];

  // תור 1: בקשה טבעית - מעבר לחשמלי והשוואת נטו
  messages.push({ role: "user", content: "אני שוקלת לעבור מהקורולה קרוס לרכב חשמלי. כמה זה ישנה לי בנטו?" });
  await turn("תור 1: מעבר לחשמלי", service, ctx, messages, budget);

  // תור 2: תיקון עובדה באמצע
  messages.push({ role: "user", content: "אגב, טעיתי - השכר שלי הוא 15,000 ולא מה שרשום. תקני בבקשה." });
  await turn("תור 2: תיקון שכר", service, ctx, messages, budget);

  console.log(`\n--- צריכה מוערכת: $${budget.estimatedUsd.toFixed(4)} ב-${budget.calls} קריאות (אומדן, לא תקרת חיוב) ---`);
  process.exit(0);
}
main().catch((e) => { console.error(redact(e instanceof Error ? e.stack ?? e.message : String(e))); process.exit(1); });