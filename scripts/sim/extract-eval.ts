// scripts/sim/extract-eval.ts
// בדיקת חילוץ 3 תלושים סינתטיים מול ground-truth. ספק: Gemini (MODEL_API_KEY2),
// מסלול חינם בלבד. דיוק לפי שדה, שגיאות, חוסרים וזמן חילוץ. אם המכסה מוצתה -
// עצירה ודיווח, ללא מעבר לספק בתשלום. הרצה: npx tsx scripts/sim/extract-eval.ts
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../src/server/web/load-env.js";
loadEnv();
import { extractPayslip, getExtractionModelId } from "../../src/server/agent/payslip-extract.js";
import { GROUND_TRUTH } from "./payslip-truth.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../../tests/fixtures/payslips");
const RATE = new Set(["pensionRate", "trainingRate"]);

type GT = Record<string, number | null>;

function approxEq(a: number, b: number, key: string): boolean {
  if (RATE.has(key)) return Math.abs(a - b) < 0.0005; // שבר
  return Math.abs(a - b) < 0.5; // שקלים/נקודות
}

async function main() {
  const modelId = getExtractionModelId();
  console.log(`extraction model=${modelId} (ספק Google, מסלול חינם בלבד)\n`);
  const files = Object.keys(GROUND_TRUTH);
  let totalFields = 0, correct = 0;

  for (const file of files) {
    const gt = (GROUND_TRUTH as Record<string, GT>)[file]!;
    const bytes = readFileSync(join(dir, file));
    const t0 = Date.now();
    let extraction;
    try {
      extraction = await extractPayslip(bytes, "application/pdf");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // זיהוי מיצוי מכסה (429/RESOURCE_EXHAUSTED) -> עצירה ללא מעבר לתשלום.
      if (/429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg)) {
        console.error(`\n[עצירה] מכסת המסלול החינמי מוצתה (${msg.slice(0, 120)}). אין מעבר אוטומטי לספק בתשלום.`);
        process.exit(2);
      }
      console.error(`[שגיאה] ${file}: ${msg.slice(0, 160)}`);
      continue;
    }
    const ms = Date.now() - t0;

    console.log(`=== ${file}  (חילוץ ${ms}ms) ===`);
    for (const key of Object.keys(gt)) {
      const expected = gt[key];
      const got = (extraction as unknown as Record<string, { value: number | null; confidence: string }>)[key];
      const gotVal = got?.value ?? null;
      totalFields++;
      let ok: boolean;
      let note = "";
      if (expected === null) {
        ok = gotVal === null; // חסר אמור להישאר null (לא הוסק אפס/אחוז)
        if (!ok) note = `(אמור להיות null, חולץ ${gotVal})`;
      } else if (gotVal === null) {
        ok = false; note = `(אמור ${expected}, חולץ null - חוסר)`;
      } else {
        ok = approxEq(gotVal, expected as number, key);
        if (!ok) note = `(אמור ${expected}, חולץ ${gotVal})`;
      }
      if (ok) correct++;
      console.log(`   [${ok ? "✓" : "✗"}] ${key}: ${gotVal ?? "null"} conf=${got?.confidence ?? "-"} ${note}`);
    }
    if (extraction.notes) console.log(`   notes: ${extraction.notes}`);
    console.log("");
  }

  console.log(`=== דיוק כולל: ${correct}/${totalFields} שדות (${Math.round((correct / totalFields) * 100)}%) ===`);
  process.exit(0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });