// src/server/agent/chat-runtime.ts
// מחבר את ששת הכלים הקיימים למודל, עם streaming ושיחה טבעית בעברית.
// עקרונות: המודל מנהל שיחה; חישוב וזכאות בקוד בלבד; הכרטיס מתוצאת המנוע.
// זהות (owner/case) מהשרת בלבד - לעולם לא מהמודל. תקציב/צעדים מוגבלים.

import { streamText, tool, stepCountIs, type ModelMessage } from "ai";
import type { CaseService } from "../services/case-service.js";
import type { CaseState } from "../../domain/contracts/case.js";
import { getModel, BUDGET, estimateUsd, getModelId } from "./model.js";
import type { ToolContext } from "./tool-contracts.js";

// הכלים הקיימים (לוגיקה לא משוכפלת).
import { readCaseStateInput, readCaseState } from "./tools/read-case-state.js";
import { updateCaseInput, updateCase } from "./tools/update-case.js";
import { manageScenariosInput, manageScenarios } from "./tools/manage-scenarios.js";
import { searchVehiclesInput, searchVehicles } from "./tools/search-vehicles.js";
import { compareScenariosInput, compareScenarios } from "./tools/compare-scenarios.js";
import { openInquiryInput, openInquiry } from "./tools/open-inquiry.js";

/** בונה תקציר תיק קצר להזרקה בכל תור (לא כל ההיסטוריה). */
function caseSummary(state: CaseState): string {
  const f = state.facts;
  const alt = state.scenarios.find((s) => s.role === "alternative");
  const base = state.scenarios.find((s) => s.role === "baseline");
  const cmp = state.latestComparison;
  const lines = [
    `גרסת עובדות: ${state.case.factsRevision}`,
    `עיסוק=${f.occupationCode ?? "לא ידוע"} קבוצה=${f.reportedGroup ?? "לא ידוע"}`,
    `שכר=${f.baseSalary ?? "?"} עמלות=${f.commission ?? "?"} בונוס=${f.bonus ?? "?"}`,
    `פנסיה=${f.pensionRate ?? "?"} קה"ש=${f.trainingRate ?? "?"} נק'זיכוי=${f.creditPoints ?? "?"} ילדים=${f.qualifyingChildren ?? "?"}`,
    base ? `baseline: מסלול=${base.route} רכב=${base.vehicleCode ?? "—"} השתתפות=${base.participation ?? "?"}` : "אין baseline",
    alt ? `חלופה: מסלול=${alt.route} רכב=${alt.vehicleCode ?? "—"} השתתפות=${alt.participation ?? "?"} overrides=${JSON.stringify(alt.overrides)}` : "אין חלופה פעילה",
    cmp ? `השוואה אחרונה: גרסת-עובדות=${cmp.factsRevision} דלתא-נטו=${cmp.result.netDeltaDisplay}` : "אין השוואה שמורה",
    state.openInquiries.length > 0 ? `פניות פתוחות: ${state.openInquiries.map((q) => q.type).join(", ")}` : "אין פניות פתוחות",
  ];
  return lines.join("\n");
}

const SYSTEM = `את/ה יועץ/ת הרכב של שטראוס. נהל/י שיחה טבעית, חמה וברורה בעברית.

עקרונות ליבה:
- ענה/י לשאלה שנשאלה, גם אם העובד/ת עצר/ה באמצע איסוף נתונים. אל תחזור/י לשאלון קבוע.
- קלוט/י כמה פרטים מהודעה אחת ועדכן/י אותם יחד (updateCase) לאחר ולידציה.
- הבחן/י בין תיקון עובדה אמיתית (updateCase) לבין סימולציה היפותטית (manageScenarios עם override שכר).
- שאל/י רק על מידע חסר או עמום שנחוץ לצעד המבוקש. אל תשאל/י שוב על מידע תקף שכבר נמסר.
- אל תפעיל/י השוואה על כל הודעה. חישוב (compareScenarios) מופעל כשהעובד/ת מבקש/ת וכשיש קלט מתאים.
- חישוב וזכאות נעשים בקוד בלבד (דרך הכלים). אין להמציא מספרים, זכאות או הצלחת פעולה.
- המספרים בכרטיס מגיעים ישירות מפלט המנוע (הכלי). את/ה מנסח/ת הסבר טבעי סביבם, בלי לשנות אותם.
- כשחסר מידע לקביעת זכאות, אמור/י "זכאות לא ידועה" ואת החסר - לא "לא זכאי".
- פנייה לנציג (openInquiry) מיועדת לנושאים שבתחום אחריותו בלבד, לא לכל בקשה.

השתמש/י בכלים לפי הצורך. התקציר של התיק מוזרק בכל תור; קרא/י פרטים נוספים (readCaseState) רק אם צריך.`;

export interface ChatBudgetState {
  estimatedUsd: number;
  calls: number;
}

/** בונה את מפת הכלים ל-AI SDK מעל השירות וה-ctx (זהות מהשרת). */
function buildTools(service: CaseService, ctx: ToolContext) {
  return {
    readCaseState: tool({
      description: "קריאת פרטי מצב התיק לפי צורך (facts/scenarios/latestComparison).",
      inputSchema: readCaseStateInput,
      execute: (input) => readCaseState(service, ctx, input),
    }),
    updateCase: tool({
      description: "עדכון עובדות משותפות אמיתיות על העובד (תיקון, לא סימולציה). בדיקת גרסה חובה.",
      inputSchema: updateCaseInput,
      execute: (input) => updateCase(service, ctx, input),
    }),
    manageScenarios: tool({
      description: "ניהול חלופה: קביעת רכב/מסלול/השתתפות ושינוי היפותטי (override שכר ברמת התרחיש).",
      inputSchema: manageScenariosInput,
      execute: (input) => manageScenarios(service, ctx, input),
    }),
    searchVehicles: tool({
      description: "חיפוש רכבים בקטלוג עם סטטוס זכאות. סינון רק לפי שדות שקיימים במקור מאומת.",
      inputSchema: searchVehiclesInput,
      execute: (input) => searchVehicles(service, ctx, input),
    }),
    compareScenarios: tool({
      description: "השוואת נטו: explicit (רכבים/ויתור) או discover (סריקה+מיון לפי חיסכון). חישוב בקוד.",
      inputSchema: compareScenariosInput,
      execute: (input) => compareScenarios(service, ctx, input),
    }),
    openInquiry: tool({
      description: "פתיחת פנייה לנציג לנושא שבתחום אחריותו (השתתפות/הבהרת זכאות). dedup אוטומטי.",
      inputSchema: openInquiryInput,
      execute: (input) => openInquiry(service, ctx, input),
    }),
  };
}

export interface StreamChatArgs {
  service: CaseService;
  ctx: ToolContext;
  state: CaseState;
  messages: ModelMessage[];
  budget: ChatBudgetState;
}

/** מריץ תור שיחה עם streaming וכלים. מחזיר את תוצאת streamText. */
export function streamChat(args: StreamChatArgs) {
  const { service, ctx, state, messages, budget } = args;
  if (budget.estimatedUsd >= BUDGET.maxEstimatedUsd) {
    throw new Error(
      `תקציב הניסוי המוערך (~$${BUDGET.maxEstimatedUsd}) נוצל. צריכה מוערכת: $${budget.estimatedUsd.toFixed(4)} (אומדן, לא תקרת חיוב קשיחה).`,
    );
  }
  const system = SYSTEM + "\n\n--- תקציר התיק (עדכני) ---\n" + caseSummary(state);
  return streamText({
    model: getModel(),
    system,
    messages,
    tools: buildTools(service, ctx),
    stopWhen: stepCountIs(BUDGET.maxSteps),
    maxOutputTokens: BUDGET.maxOutputTokens,
    onFinish: (ev) => {
      const inTok = ev.usage?.inputTokens ?? 0;
      const outTok = ev.usage?.outputTokens ?? 0;
      budget.estimatedUsd += estimateUsd(inTok, outTok);
      budget.calls += 1;
    },
  });
}

/**
 * מסיר חלקי reasoning/thinking מהודעות ה-assistant לפני שליחה חוזרת.
 * מודלים חדשים של Anthropic כובלים thinking ל-system+tools+היסטוריה; מכיוון
 * שתקציר התיק מוזרק ל-system ומשתנה בכל תור, ה-binding נשבר. הטקסט ותוצאות
 * הכלים נשמרים ומספיקים להמשכיות; ה-reasoning נזרק בבטחה.
 */
export function stripReasoning(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((m) => {
    if (m.role !== "assistant" || !Array.isArray(m.content)) return m;
    const filtered = m.content.filter(
      (p) => (p as { type?: string }).type !== "reasoning",
    );
    return { ...m, content: filtered } as ModelMessage;
  });
}

export { getModelId };