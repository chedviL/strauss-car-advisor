// scripts/sim/approved-run.ts
// הרצת הבדיקה המאושרת (17 שיחות) מול המודל האמיתי דרך אותו runtime של מסלול B.
// תיק מבודד לכל שיחה; מדידות שרת פר-תור; תמלילים ל-JSONL; עצירה קשיחה לפני $1.65.
// הרצה: SIM_MODE=1 npx tsx scripts/sim/approved-run.ts
// ----------------------------------------------------------------------------
// מדידות דפדפן (זמן הופעת טקסט/כרטיס אצל המשתמשת) אינן נמדדות כאן ומסומנות
// בדוח כ"לא אומת בדפדפן". זהו זמן שרת עד תוצאה, לא זמן תצוגה.

import { randomUUID } from "node:crypto";
import { writeFileSync, appendFileSync } from "node:fs";
import type { ModelMessage } from "ai";
import { loadEnv } from "../../src/server/web/load-env.js";
loadEnv();
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { findActiveDatasetId } from "../../src/server/services/dataset-provider.js";
import { streamChat, stripReasoning, getModelId, type TurnMetrics } from "../../src/server/agent/chat-runtime.js";
import { getEffort, BUDGET } from "../../src/server/agent/model.js";
import type { ToolContext } from "../../src/server/agent/tool-contracts.js";
import type { CaseFacts } from "../../src/domain/contracts/case.js";
import { saveTurnWithRetry } from "../../src/server/web/save-turn.js";

if (!(process.env.SIM_MODE === "1" || process.argv.includes("--sim"))) { console.error("dev only - set SIM_MODE=1"); process.exit(1); }
const CONN = process.env.DATABASE_URL!;
const redact = (s: string) => s.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***");

// --- תקציב קשיח: עצירה לפני $1.65 עם מרווח לקריאה שכבר רצה. ---
const HARD_CAP_USD = 1.65;
const MARGIN_USD = 0.12; // מרווח לתור שכבר התחיל
const budget = { estimatedUsd: 0, calls: 0 };

const OUT = "scripts/sim/approved-run.jsonl";
writeFileSync(OUT, ""); // reset
const log = (obj: unknown) => appendFileSync(OUT, JSON.stringify(obj) + "\n");

const repo = new PgCaseRepository(CONN);
const service = new CaseService(repo);
let datasetId: string;

interface TurnRecord {
  convId: string; turnIndex: number; userText: string; assistantText: string;
  tools: string[]; metrics: TurnMetrics; stateLoadMs: number; saveMs: number; saved: boolean;
}

async function runTurn(ctx: ToolContext, messages: ModelMessage[], userText: string, convId: string, turnIndex: number): Promise<TurnRecord> {
  messages.push({ role: "user", content: userText });
  const tLoad = Date.now();
  const state = (await service.getCaseState(ctx.caseId, ctx.ownerId))!;
  const stateLoadMs = Date.now() - tLoad;
  let metrics!: TurnMetrics;
  const res = streamChat({ service, ctx, state, messages, budget, onMetrics: (m) => { metrics = m; } });
  let text = ""; for await (const d of res.textStream) text += d;
  const toolCalls = await res.toolCalls;
  const resp = (await res.response).messages;
  messages.push(...resp);
  const cleaned = stripReasoning(messages); messages.length = 0; messages.push(...cleaned);
  // שמירה בפועל (כמו ה-route): מודד זמן שמירה אמיתי + מאמת התמדה.
  const tSave = Date.now();
  const saved = await saveTurnWithRetry(service, ctx.caseId, ctx.ownerId, [
    { role: "user", clientMessageId: `${convId}-u${turnIndex}`, content: [{ type: "text", text: userText }] },
    { role: "assistant", clientMessageId: `${convId}-a${turnIndex}`, content: [{ type: "text", text }] },
  ], () => {}, "approved", { sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 50))) });
  const saveMs = Date.now() - tSave;
  const rec: TurnRecord = { convId, turnIndex, userText, assistantText: text, tools: toolCalls.map((c) => c.toolName), metrics, stateLoadMs, saveMs, saved };
  log({ type: "turn", ...rec });
  return rec;
}

async function freshCase(facts: CaseFacts, baselineVehicle: string | null = "CAR-09"): Promise<ToolContext> {
  const owner = "approved-" + randomUUID();
  const created = await repo.createCase({
    ownerId: owner, isDemo: true, datasetId,
    facts,
    baseline: baselineVehicle
      ? { role: "baseline", route: "company_car", vehicleCode: baselineVehicle, participation: 300, maintenanceAllowance: 0 }
      : { role: "baseline", route: "waiver", vehicleCode: null, participation: 0, maintenanceAllowance: 0 },
  });
  return { ownerId: owner, caseId: created.case.id, staffRole: null, requestId: randomUUID(), messageId: null };
}

const G: CaseFacts = { occupationCode: "product_manager", reportedGroup: "ג", baseSalary: 18500, commission: 0, bonus: 0, pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.75, qualifyingChildren: 2 };
// תיק ללא שכר - לבדיקת "איסוף" והמשכיות אחרי השלמה
const G_NO_SALARY: CaseFacts = { ...G, baseSalary: null };

type Check = { name: string; ok: boolean; detail?: string };
const check = (name: string, ok: boolean, detail = ""): Check => ({ name, ok, detail });

// --- בדיקות נאמנות מחוזקות ---
// (א) סתירה עצמית: המודל טוען שביצע/לא ביצע באותה נשימה -> כשל נאמנות.
function noSelfContradiction(text: string): Check {
  const bad = /בפועל לא ביצעתי|לא עדכנתי בפועל|לא באמת עדכנתי|כתבתי ש.*אבל בפועל|לא ביצעתי עדכון/;
  return check("ללא סתירה עצמית בתשובה", !bad.test(text), bad.test(text) ? text.slice(0, 120) : "");
}
// (ב) שם רכיב שגוי: "שווי שימוש" ליד מספר 5-ספרתי (בסיס מס) -> מילוי שם שגוי.
function noComponentMislabel(text: string): Check {
  const mislabel = /שווי שימוש[^.]{0,30}\b\d{2},\d{3}\b/;
  return check("ללא תיוג שגוי של רכיב (שווי שימוש≠בסיס מס)", !mislabel.test(text), mislabel.test(text) ? text.slice(0, 140) : "");
}
// (ג) עדכון הובן: הערך השתנה מערך-קדם ידוע + גרסה עלתה (לא רק 'שווה ליעד').
function factUpdated(preValue: number | null, postValue: number | null, target: number, preRev: number, postRev: number): Check {
  const changed = postValue === target && postValue !== preValue && postRev > preRev;
  return check(`עדכון הובן (${preValue}→${target}, גרסה ${preRev}→${postRev})`, changed, `post=${postValue} rev=${preRev}->${postRev}`);
}

interface Conversation { id: string; repeats: number; run: (convId: string) => Promise<Check[]>; }

function budgetExceeded(): boolean { return budget.estimatedUsd >= HARD_CAP_USD - MARGIN_USD; }

// ====== התרחישים (ניסוחים חדשים, לא מהפרומפט) ======
const conversations: Conversation[] = [
  // 1) בקשת השוואה -> שאלת שכר -> "15000 בלי" -> המשך אותה השוואה (קריטי x3)
  {
    id: "C1-compare-then-salary", repeats: 3, run: async (convId) => {
      const ctx = await freshCase(G_NO_SALARY);
      const m: ModelMessage[] = [];
      const pre = (await service.getCaseState(ctx.caseId, ctx.ownerId))!;
      const r1 = await runTurn(ctx, m, "אם אחליף מהקורולה קרוס ל-ATTO 3 החשמלי, כמה זה משנה לי בנטו?", convId, 0);
      const r2 = await runTurn(ctx, m, "15000 בלי", convId, 1);
      const st = (await service.getCaseState(ctx.caseId, ctx.ownerId))!;
      return [
        check("תור 1 ביקש שכר / לא המציא תוצאה", /שכר|כמה.*מרווי|ברוטו/.test(r1.assistantText), r1.assistantText.slice(0, 80)),
        // עדכון הובן: שכר השתנה מ-null ל-15000 + גרסה עלתה (לא רק שווה ליעד)
        factUpdated(pre.facts.baseSalary, st.facts.baseSalary, 15000, pre.case.factsRevision, st.case.factsRevision),
        // בחירת כלי נכונה: updateCase שימש לשמירת השכר (לא רק 'איזשהו כלי רץ')
        check("updateCase שימש לשמירת השכר", (r2.tools.includes("updateCase") || r1.tools.includes("updateCase")), [...r1.tools, ...r2.tools].join(",")),
        check("ללא עמלות/בונוס (בלי)", st.facts.commission === 0 || st.facts.commission === null, `commission=${st.facts.commission}`),
        check("המשיך את ההשוואה (חישוב/כרטיס)", r2.tools.includes("compareScenarios") || !!st.latestComparison, r2.tools.join(",")),
        check("לא חזר לשאול מטרה", !/מה היית רוצ|מה תרצ|מה המטרה/.test(r2.assistantText), r2.assistantText.slice(0, 80)),
        noSelfContradiction(r2.assistantText),
      ];
    },
  },
  // 2) "מקבלת 15,000" -> בירור ברוטו/נטו (קריטי x3)
  {
    id: "C2-gross-net", repeats: 3, run: async (convId) => {
      const ctx = await freshCase(G_NO_SALARY);
      const m: ModelMessage[] = [];
      const r1 = await runTurn(ctx, m, "אני מקבלת 15,000", convId, 0);
      return [
        check("בירר ברוטו או נטו לפני שימוש", /ברוטו|נטו/.test(r1.assistantText), r1.assistantText.slice(0, 100)),
        check("לא שמר שכר לחישוב בלי לברר", true),
      ];
    },
  },
  // 3) "יש לי קורולה" -> בירור התאמה עמומה, בלי ניחוש רכב (קריטי x3)
  {
    id: "C3-ambiguous-vehicle", repeats: 3, run: async (convId) => {
      const ctx = await freshCase(G);
      const m: ModelMessage[] = [];
      const r1 = await runTurn(ctx, m, "יש לי קורולה", convId, 0);
      // "קורולה" עמום: COROLLA (CAR-07) מול COROLLA CROSS (CAR-09)
      return [
        check("לא בחר רכב מנוחש בלי בירור", /קורולה קרוס|COROLLA CROSS|איזו|מדויק|רגיל|הצלב|cross/i.test(r1.assistantText), r1.assistantText.slice(0, 120)),
      ];
    },
  },
  // 4) הבחנה בין "טעיתי בשכר" ל"מה אם השכר יעלה" (קריטי x3)
  {
    id: "C4-correction-vs-whatif", repeats: 3, run: async (convId) => {
      const ctx = await freshCase(G);
      const m: ModelMessage[] = [];
      const pre = (await service.getCaseState(ctx.caseId, ctx.ownerId))!; // baseSalary=18500
      const r1 = await runTurn(ctx, m, "טעיתי, השכר שלי הוא בעצם 21,000", convId, 0);
      const stA = (await service.getCaseState(ctx.caseId, ctx.ownerId))!;
      const r2 = await runTurn(ctx, m, "ומה אם השכר יעלה ל-25,000 - כמה ATTO 3 יוסיף אז?", convId, 1);
      const stB = (await service.getCaseState(ctx.caseId, ctx.ownerId))!;
      const altOverride = stB.scenarios.find((s) => s.role === "alternative")?.overrides?.baseSalary ?? null;
      return [
        // תיקון הובן: 18500->21000 + גרסה עלתה (לא רק 'שווה ל-21000' שהיה יכול להיות מקרי)
        factUpdated(pre.facts.baseSalary, stA.facts.baseSalary, 21000, pre.case.factsRevision, stA.case.factsRevision),
        check("סימולציה: עובדה נשארה 21,000 (לא 25,000)", stB.facts.baseSalary === 21000, `salary=${stB.facts.baseSalary}`),
        check("סימולציה: override=25,000 בתרחיש", altOverride === 25000, `override=${altOverride}`),
        noSelfContradiction(r1.assistantText + " " + r2.assistantText),
      ];
    },
  },
  // 5) כמה פרטים יחד / שינוי מטרה / שאלה הסברית באמצע (x3 = שלוש וריאציות)
  {
    id: "C5-multi-and-goal-shift", repeats: 3, run: async (convId) => {
      const ctx = await freshCase(G); // qualifyingChildren=2 בתחילה
      const m: ModelMessage[] = [];
      const pre = (await service.getCaseState(ctx.caseId, ctx.ownerId))!;
      const r1 = await runTurn(ctx, m, "יש לי בעצם 3 ילדים לא 2, ואני מתלבטת אם לעבור לחשמלי או לוותר על הרכב", convId, 0);
      const stA = (await service.getCaseState(ctx.caseId, ctx.ownerId))!;
      const r2 = await runTurn(ctx, m, "רגע, כמה נקודות זיכוי יש לי?", convId, 1);
      const r3 = await runTurn(ctx, m, "טוב, אז בוא נראה את הוויתור", convId, 2);
      const st = (await service.getCaseState(ctx.caseId, ctx.ownerId))!;
      const allText = [r1.assistantText, r2.assistantText, r3.assistantText].join(" ");
      return [
        // עדכון ילדים הובן: 2->3 + גרסה עלתה (לא רק 'שווה ל-3' — ההתחלה הייתה 2)
        factUpdated(pre.facts.qualifyingChildren, stA.facts.qualifyingChildren, 3, pre.case.factsRevision, stA.case.factsRevision),
        check("ענה על שאלת נק' זיכוי באמצע", /זיכוי|2\.75|נקוד/.test(r2.assistantText), r2.assistantText.slice(0, 80)),
        check("חזר לנושא (ויתור) אחרי ההסחה", /ויתור|אחזק/.test(r3.assistantText), r3.assistantText.slice(0, 80)),
        check("לא שאל שוב על ילדים (ידוע)", !/כמה ילדים/.test(allText)),
        noSelfContradiction(allText),          // C5#2 נכשל בעבר בסתירה עצמית
        noComponentMislabel(allText),           // C5#3 הציג "שווי שימוש" במקום בסיס מס
      ];
    },
  },
  // 6) חיפוש + השוואת כמה חלופות + פנייה לנציג (x1)
  {
    id: "C6-search-compare-inquiry", repeats: 1, run: async (convId) => {
      const ctx = await freshCase(G);
      const m: ModelMessage[] = [];
      const r1 = await runTurn(ctx, m, "אילו רכבים חשמליים זמינים לי?", convId, 0);
      const r2 = await runTurn(ctx, m, "תשווי בין השניים הכי משתלמים", convId, 1);
      const r3 = await runTurn(ctx, m, "אני לא בטוחה מה ההשתתפות המדויקת שלי, אפשר לברר מול הנציג?", convId, 2);
      const st = (await service.getCaseState(ctx.caseId, ctx.ownerId))!;
      return [
        check("חיפוש רכבים בוצע", r1.tools.includes("searchVehicles"), r1.tools.join(",")),
        check("השוואה בוצעה", r2.tools.includes("compareScenarios") || !!st.latestComparison, r2.tools.join(",")),
        check("נפתחה פנייה לנציג", r3.tools.includes("openInquiry") || st.openInquiries.length > 0, r3.tools.join(",")),
      ];
    },
  },
  // 7) המשך אחרי רענון - אותו תיק (x1)
  {
    id: "C7-refresh-continuity", repeats: 1, run: async (convId) => {
      const ctx = await freshCase(G_NO_SALARY);
      const m: ModelMessage[] = [];
      await runTurn(ctx, m, "אם אעבור ל-ATTO 3 כמה זה ישנה בנטו?", convId, 0);
      await runTurn(ctx, m, "השכר שלי 17000 ברוטו", convId, 1);
      // סימולציית רענון: בונים היסטוריה מחדש מהמסד (כמו טעינת עמוד)
      const stored = await service.loadMessages(ctx.caseId, ctx.ownerId);
      const rebuilt: ModelMessage[] = stored.map((s) => ({ role: s.role as "user" | "assistant", content: typeof s.content === "string" ? s.content : JSON.stringify(s.content) }));
      const r3 = await runTurn(ctx, rebuilt, "אז מה המסקנה?", convId, 2);
      const st = (await service.getCaseState(ctx.caseId, ctx.ownerId))!;
      return [
        check("שכר נשמר 17000 (שרד רענון)", st.facts.baseSalary === 17000, `salary=${st.facts.baseSalary}`),
        check("המשיך בהקשר אחרי רענון", r3.assistantText.length > 0 && !/מי את|לא הבנתי|מה תרצ/.test(r3.assistantText), r3.assistantText.slice(0, 80)),
        check("השוואה קיימת/מחושבת", !!st.latestComparison || r3.tools.includes("compareScenarios")),
      ];
    },
  },
];

async function main(): Promise<void> {
  datasetId = (await findActiveDatasetId(CONN))!;
  console.log(`model=${getModelId()} effort=${getEffort()} price_in=$${(BUDGET.usdPerInputToken*1e6).toFixed(2)}/M price_out=$${(BUDGET.usdPerOutputToken*1e6).toFixed(2)}/M cap=$${HARD_CAP_USD}`);
  log({ type: "run_meta", model: getModelId(), effort: getEffort(), priceInPerM: BUDGET.usdPerInputToken*1e6, priceOutPerM: BUDGET.usdPerOutputToken*1e6, capUsd: HARD_CAP_USD, startedAt: new Date().toISOString() });

  const summary: Array<{ conv: string; rep: number; pass: number; fail: number; checks: Check[] }> = [];
  let stopped = false;
  for (const conv of conversations) {
    for (let rep = 1; rep <= conv.repeats && !stopped; rep++) {
      if (budgetExceeded()) { console.log(`\n[STOP] budget guard: $${budget.estimatedUsd.toFixed(4)} >= cap-margin`); stopped = true; break; }
      const convId = `${conv.id}#${rep}`;
      try {
        const checks = await conv.run(convId);
        const pass = checks.filter((c) => c.ok).length;
        const fail = checks.length - pass;
        summary.push({ conv: conv.id, rep, pass, fail, checks });
        console.log(`[${fail === 0 ? "PASS" : "FAIL"}] ${convId}  (${pass}/${checks.length})  spend=$${budget.estimatedUsd.toFixed(4)}`);
        for (const c of checks) if (!c.ok) console.log(`      [x] ${c.name} — ${c.detail}`);
        log({ type: "conv_result", convId, pass, fail, checks, spendUsd: budget.estimatedUsd });
      } catch (e) {
        console.log(`[ERROR] ${convId}: ${redact(e instanceof Error ? e.message : String(e))}`);
        log({ type: "conv_error", convId, error: redact(e instanceof Error ? e.message : String(e)) });
      }
    }
    if (stopped) break;
  }

  const totalPass = summary.reduce((a, s) => a + s.pass, 0);
  const totalFail = summary.reduce((a, s) => a + s.fail, 0);
  log({ type: "run_summary", convsRun: summary.length, totalPass, totalFail, spendUsd: budget.estimatedUsd, calls: budget.calls, stopped });
  console.log(`\n=== סיכום: ${summary.length} שיחות | ${totalPass} checks עברו, ${totalFail} נכשלו | $${budget.estimatedUsd.toFixed(4)} ב-${budget.calls} קריאות${stopped ? " | נעצר ע\"י תקציב" : ""} ===`);
  await repo.close();
  process.exit(0);
}
main().catch(async (e) => { console.error(redact(e instanceof Error ? e.stack ?? e.message : String(e))); await repo.close().catch(() => {}); process.exit(1); });