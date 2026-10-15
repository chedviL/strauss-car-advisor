// scripts/sim/verify-sdk.ts
// מאמת שה-AI SDK + provider Anthropic מעבירים את claude-sonnet-5-5, כולל
// tool calling ו-streaming. המפתח מועבר מפורשות מצד השרת (MODEL_API_KEY).
// הרצה: tsx scripts/sim/verify-sdk.ts

import { loadEnv } from "../../src/server/web/load-env.js";
loadEnv();
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, streamText, tool } from "ai";
import { z } from "zod";

const KEY = process.env.MODEL_API_KEY;
const MODEL = "claude-sonnet-5-5";
function redact(s: string): string { return s.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***"); }

async function main(): Promise<void> {
  if (!KEY) { console.error("MODEL_API_KEY לא נטען"); process.exit(2); }
  const anthropic = createAnthropic({ apiKey: KEY });

  // 1) טקסט בסיסי
  try {
    const r = await generateText({ model: anthropic(MODEL), prompt: "ענה במילה אחת: שלום?" });
    console.log("✓ generateText:", r.text.trim(), "| finishReason:", r.finishReason);
  } catch (e) { console.error("✗ generateText:", redact(e instanceof Error ? e.message : String(e))); process.exit(1); }

  // 2) tool calling
  try {
    const r = await generateText({
      model: anthropic(MODEL),
      prompt: "כמה זה 14200 ועוד 1000? השתמש בכלי add.",
      tools: {
        add: tool({
          description: "מחבר שני מספרים",
          inputSchema: z.object({ a: z.number(), b: z.number() }),
          execute: async ({ a, b }) => ({ sum: a + b }),
        }),
      },
      stopWhen: undefined,
    });
    const calls = r.toolCalls?.length ?? 0;
    console.log(`✓ tool calling: ${calls} קריאת כלי; finishReason=${r.finishReason}`);
  } catch (e) { console.error("✗ tool calling:", redact(e instanceof Error ? e.message : String(e))); process.exit(1); }

  // 3) streaming
  try {
    const r = streamText({ model: anthropic(MODEL), prompt: "מנה שלוש ערים בישראל, בקצרה." });
    let chunks = 0; let text = "";
    for await (const d of r.textStream) { chunks++; text += d; }
    console.log(`✓ streaming: ${chunks} chunks, ${text.length} תווים`);
  } catch (e) { console.error("✗ streaming:", redact(e instanceof Error ? e.message : String(e))); process.exit(1); }

  console.log("\n✓ ה-SDK וה-provider תואמים ל-" + MODEL + " (טקסט, כלים, streaming).");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });