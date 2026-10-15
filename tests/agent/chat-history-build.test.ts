// tests/agent/chat-history-build.test.ts
// בדיקת בניית ההיסטוריה למסלול B (ללא מודל). מוכיחה את *הבקשה שנבנית בפועל*:
// ההודעה הנוכחית מופיעה פעם אחת, שאלת ההשלמה הקודמת נשמרת, ו-reasoning מוסר.
// בנוסף: תמונת המצב (עובדות) מגיעה ל-system בכל תור.
import { describe, it, expect } from "vitest";
import { convertToModelMessages, type UIMessage, type ModelMessage } from "ai";
import { stripReasoning } from "../../src/server/agent/chat-runtime.js";
import { buildContext } from "../../src/server/agent/context.js";
import type { CaseState } from "../../src/domain/contracts/case.js";

function textPart(text: string) { return { type: "text" as const, text }; }

// שיחה: בקשת השוואה -> שאלת השלמה של הבוט -> תשובה קצרה של העובדת.
const uiMessages: UIMessage[] = [
  { id: "u1", role: "user", parts: [textPart("אם אעבור מהקורולה קרוס ל-BYD Atto 3 — כמה זה ישנה לי בנטו?")] },
  { id: "a1", role: "assistant", parts: [textPart("אני צריכה את שכר הבסיס החודשי שלך. יש גם עמלות או בונוס קבועים?")] },
  { id: "u2", role: "user", parts: [textPart("15000 בלי")] },
];

function allText(messages: ModelMessage[]): string {
  return messages.map((m) => {
    if (typeof m.content === "string") return m.content;
    return (m.content as Array<{ type: string; text?: string }>).map((p) => p.text ?? "").join(" ");
  }).join("\n");
}

describe("בניית היסטוריה למסלול B (הבקשה בפועל)", () => {
  it("ההודעה הנוכחית מופיעה פעם אחת בלבד", async () => {
    const model = await convertToModelMessages(uiMessages);
    const text = allText(model);
    const occurrences = text.split("15000 בלי").length - 1;
    expect(occurrences).toBe(1);
  });

  it("שאלת ההשלמה הקודמת של הבוט נשמרת בהיסטוריה", async () => {
    const model = await convertToModelMessages(uiMessages);
    const text = allText(model);
    expect(text).toContain("שכר הבסיס החודשי");
    // סדר נכון: שאלת הבוט לפני התשובה הנוכחית
    expect(text.indexOf("שכר הבסיס החודשי")).toBeLessThan(text.indexOf("15000 בלי"));
  });

  it("stripReasoning מסיר reasoning אך שומר טקסט ותוצאות כלים", () => {
    const withReasoning: ModelMessage[] = [
      { role: "assistant", content: [
        { type: "reasoning", text: "חשיבה פנימית שלא צריכה לחזור" } as never,
        { type: "text", text: "תשובה גלויה" },
      ] },
    ];
    const stripped = stripReasoning(withReasoning);
    const text = allText(stripped);
    expect(text).toContain("תשובה גלויה");
    expect(text).not.toContain("חשיבה פנימית");
  });

  it("ההיסטוריה אינה נחתכת לאורך שרירותי קצר (נשמרים תורות קודמים)", async () => {
    // 20 תורות; כולם צריכים לשרוד ל-convertToModelMessages (החיתוך אינו כאן).
    const many: UIMessage[] = [];
    for (let i = 0; i < 10; i++) {
      many.push({ id: `u${i}`, role: "user", parts: [textPart(`הודעה ${i}`)] });
      many.push({ id: `a${i}`, role: "assistant", parts: [textPart(`מענה ${i}`)] });
    }
    const model = await convertToModelMessages(many);
    const text = allText(model);
    expect(text).toContain("הודעה 0"); // התור הראשון עדיין שם
    expect(text).toContain("מענה 9");
  });

  it("buildContext מזריק עובדות עדכניות ל-system (ערוץ נפרד מההיסטוריה)", () => {
    const state = {
      case: { id: "c1", ownerId: "o1", isDemo: true, datasetId: "d1", status: "active", factsRevision: 2, pendingRequest: null, createdAt: "", updatedAt: "" },
      facts: { occupationCode: "product_manager", reportedGroup: "ג", baseSalary: 15000, commission: 0, bonus: 0, pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.25, qualifyingChildren: 2 },
      scenarios: [],
      latestComparison: null,
      openInquiries: [],
    } as unknown as CaseState;
    const ctx = buildContext(state);
    expect(ctx).toContain("15000"); // השכר שנמסר נמצא בתמונת המצב
    expect(ctx).toContain("קבוצה מדווחת=ג");
    expect(ctx).toContain("גרסת עובדות 2"); // גרסה לבדיקת conflict
  });

  it("stripReasoning שומר על רצף tool-call ↔ tool-result (toolCallId תואם) ומסיר רק reasoning", () => {
    // היסטוריה מציאותית: assistant[reasoning + tool-call] -> tool[tool-result] -> assistant[reasoning + text].
    const history: ModelMessage[] = [
      { role: "user", content: [{ type: "text", text: "השווה לי לרכב חשמלי" }] },
      { role: "assistant", content: [
        { type: "reasoning", text: "צריך לקרוא ל-compareScenarios" } as never,
        { type: "tool-call", toolCallId: "call-1", toolName: "compareScenarios", input: { mode: "discover" } } as never,
      ] },
      { role: "tool", content: [
        { type: "tool-result", toolCallId: "call-1", toolName: "compareScenarios", output: { type: "json", value: { status: "ok" } } } as never,
      ] },
      { role: "assistant", content: [
        { type: "reasoning", text: "אנסח את התוצאה" } as never,
        { type: "text", text: "החשמלי משפר לך את הנטו." },
      ] },
    ];
    const out = stripReasoning(history);

    // 1) אין reasoning בשום הודעה
    for (const m of out) {
      if (Array.isArray(m.content)) {
        expect(m.content.some((p) => (p as { type?: string }).type === "reasoning")).toBe(false);
      }
    }
    // 2) ה-tool-call נשמר ב-assistant
    const asst = out[1]!;
    const callParts = (asst.content as Array<{ type: string; toolCallId?: string }>).filter((p) => p.type === "tool-call");
    expect(callParts).toHaveLength(1);
    expect(callParts[0]!.toolCallId).toBe("call-1");
    // 3) ה-tool-result נשמר ב-tool role עם אותו toolCallId
    const toolMsg = out[2]!;
    const resParts = (toolMsg.content as Array<{ type: string; toolCallId?: string }>).filter((p) => p.type === "tool-result");
    expect(resParts).toHaveLength(1);
    expect(resParts[0]!.toolCallId).toBe("call-1");
    // 4) כל tool-call מתמפה ל-tool-result (אין קריאה יתומה שתיפסל בפנייה אמיתית)
    const callIds = new Set(callParts.map((p) => p.toolCallId));
    const resIds = new Set(resParts.map((p) => p.toolCallId));
    for (const id of callIds) expect(resIds.has(id)).toBe(true);
    // 5) הטקסט הגלוי נשמר
    const lastText = (out[3]!.content as Array<{ type: string; text?: string }>).find((p) => p.type === "text");
    expect(lastText?.text).toContain("הנטו");
  });

  it("stripReasoning אינו משנה הודעות user/tool ואינו מסיר תוכן לא-reasoning", () => {
    const history: ModelMessage[] = [
      { role: "user", content: [{ type: "text", text: "שלום" }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "x", toolName: "t", output: { type: "json", value: {} } } as never] },
    ];
    const out = stripReasoning(history);
    expect(out[0]).toEqual(history[0]); // user ללא שינוי
    expect((out[1]!.content as unknown[]).length).toBe(1); // tool-result נשמר
  });
});
