// scripts/sim/verify-model.ts
// מאמת זמינות מודל דרך Anthropic Models API (עם pagination), ואז קריאת ניסיון
// קטנה. אינו מדפיס את המפתח או סודות. אינו מנחש מזהה חלופי.
// הרצה: tsx scripts/sim/verify-model.ts <model-id>

import { loadEnv } from "../../src/server/web/load-env.js";
loadEnv();

const KEY = process.env.MODEL_API_KEY;
const TARGET = process.argv[2] ?? "claude-sonnet-5-5";
const BASE = "https://api.anthropic.com/v1";

function redact(s: string): string {
  // מסיר כל רצף שנראה כמו מפתח (sk-...) מהודעות שגיאה
  return s.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***");
}

async function listAllModels(): Promise<string[]> {
  const ids: string[] = [];
  let afterId: string | null = null;
  for (let page = 0; page < 20; page++) {
    const url = new URL(BASE + "/models");
    url.searchParams.set("limit", "100");
    if (afterId) url.searchParams.set("after_id", afterId);
    const res = await fetch(url, {
      headers: { "x-api-key": KEY!, "anthropic-version": "2023-06-01" },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Models API ${res.status}: ${redact(body).slice(0, 300)}`);
    }
    const json = (await res.json()) as { data: Array<{ id: string }>; has_more: boolean; last_id: string | null };
    for (const m of json.data) ids.push(m.id);
    if (!json.has_more || !json.last_id) break;
    afterId = json.last_id;
  }
  return ids;
}

async function tinyCall(model: string): Promise<string> {
  const res = await fetch(BASE + "/messages", {
    method: "POST",
    headers: { "x-api-key": KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 16,
      messages: [{ role: "user", content: "אמור שלום במילה אחת." }],
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Messages API ${res.status}: ${redact(body).slice(0, 300)}`);
  const json = JSON.parse(body) as { content: Array<{ type: string; text?: string }>; usage?: { input_tokens: number; output_tokens: number } };
  const text = json.content.map((c) => c.text ?? "").join("");
  const usage = json.usage ? `in=${json.usage.input_tokens} out=${json.usage.output_tokens}` : "n/a";
  return `תשובה="${text.trim()}" usage(${usage})`;
}

async function main(): Promise<void> {
  if (!KEY) { console.error("MODEL_API_KEY לא נטען. בדוק .env.local (נוכחות בלבד)."); process.exit(2); }
  console.log(`בודק זמינות מודל: ${TARGET}`);
  let models: string[];
  try {
    models = await listAllModels();
  } catch (e) {
    console.error("כשל ברשימת המודלים:", redact(e instanceof Error ? e.message : String(e)));
    process.exit(1);
  }
  const available = models.includes(TARGET);
  console.log(`סה"כ מודלים זמינים לחשבון: ${models.length}`);
  // מציג רק את מזהי ה-sonnet/opus הרלוונטיים (לא כל הרשימה)
  const relevant = models.filter((m) => /sonnet|opus|haiku/i.test(m));
  console.log("מזהים רלוונטיים:", relevant.join(", "));
  if (!available) {
    console.error(`\n✗ המודל "${TARGET}" אינו מופיע ברשימת המודלים הזמינים לחשבון זה.`);
    console.error("לא מבצע auto-switch ולא מנחש מזהה חלופי. ראה את המזהים הרלוונטיים למעלה.");
    process.exit(3);
  }
  console.log(`\n✓ "${TARGET}" זמין. מבצע קריאת ניסיון קטנה...`);
  try {
    const r = await tinyCall(TARGET);
    console.log("✓ קריאת ניסיון הצליחה:", r);
  } catch (e) {
    console.error("✗ קריאת הניסיון נכשלה:", redact(e instanceof Error ? e.message : String(e)));
    process.exit(4);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });