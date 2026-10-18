// src/server/agent/turn-meter.ts
// מודד תור טהור וניתן-לבדיקה (שעון מוזרק). מפריד בין שלושה אירועי-זמן שונים
// שבלבלו ביניהם בעבר:
//   - toolResultMs: מתי תוצאת הכלי (למשל compareScenarios) הייתה מוכנה בשרת.
//   - firstTextMs:  מתי נשלח אירוע הטקסט הראשון ללקוח (לא זמן תצוגה בדפדפן).
//   - totalMs:      סיום התור בשרת.
// הערה: toolResultMs הוא "תוצאה מוכנה בשרת", ולא "כרטיס שהוצג בדפדפן".

export interface TurnMeterMetrics {
  modelCalls: number;
  toolCount: number;
  firstTextMs: number | null;   // אירוע טקסט ראשון שנשלח ללקוח (שרת)
  toolResultMs: number | null;  // תוצאת כלי ראשונה מוכנה (שרת) - חליף cardMs
  compareResultMs: number | null; // תוצאת compareScenarios מוכנה (שרת)
  totalMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

/** אירוע chunk מופשט (תואם ל-onChunk של ה-SDK). */
export interface MeterChunk { type?: string }
/** צעד מופשט (תואם ל-onStepFinish): קריאות כלים ותוצאותיהן. */
export interface MeterStep {
  toolCalls?: Array<{ toolName?: string; input?: unknown }>;
  toolResults?: Array<{ toolName?: string; output?: unknown }>;
}

/** בודק אם פלט כלי מייצג הצלחה. הכלים מחזירים ToolResult עם status="success". */
function isToolSuccess(output: unknown): boolean {
  const o = output as { status?: string } | undefined;
  return o?.status === "success";
}

export function createTurnMeter(now: () => number = () => Date.now()) {
  const t0 = now();
  const ms = () => now() - t0;
  let modelCalls = 0;
  let toolCount = 0;
  let firstTextMs: number | null = null;
  let toolResultMs: number | null = null;
  let compareResultMs: number | null = null;

  return {
    onChunk(chunk: MeterChunk): void {
      // טקסט ראשון = chunk מסוג text-delta/text (האירוע הראשון שנשלח ללקוח).
      if (firstTextMs === null && (chunk.type === "text-delta" || chunk.type === "text")) {
        firstTextMs = ms();
      }
    },
    onStepFinish(step: MeterStep): void {
      modelCalls += 1;
      for (const _c of step.toolCalls ?? []) toolCount += 1;
      for (const r of step.toolResults ?? []) {
        if (isToolSuccess(r.output)) {
          if (toolResultMs === null) toolResultMs = ms();
          if (compareResultMs === null && r.toolName === "compareScenarios") compareResultMs = ms();
        }
      }
    },
    finalize(usage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }): TurnMeterMetrics {
      return {
        modelCalls, toolCount, firstTextMs, toolResultMs, compareResultMs,
        totalMs: ms(),
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cachedInputTokens: usage?.cachedInputTokens ?? 0,
      };
    },
  };
}