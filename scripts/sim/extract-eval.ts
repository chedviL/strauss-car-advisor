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

type Variant = { suffix: string; mime: "application/pdf" | "image/png" | "image/jpeg"; label: string };
const VARIANTS: Record<string, Variant> = {
  pdf:           { suffix: ".pdf", mime: "application/pdf", label: "PDF (שכבת טקסט)" },
  "scan-clear":  { suffix: "-scan-clear.png", mime: "image/png", label: "סריקה חדה (תמונה, ללא טקסט)" },
  "scan-degraded": { suffix: "-scan-degraded.jpg", mime: "image/jpeg", label: "סריקה פחות איכותית (תמונה, ללא טקסט)" },
};

async function main() {
  const modelId = getExtractionModelId();
  const variantKey = (process.argv.find((a) => a.startsWith("--variant="))?.split("=")[1]) ?? "pdf";
  const variant = VARIANTS[variantKey];
  if (!variant) { console.error("variant לא מוכר. אפשרויות: pdf | scan-clear | scan-degraded"); process.exit(1); }
  console.log(`extraction model=${modelId} | variant=${variant.label}`);
  console.log(`הערה: היעדר fallback בקוד אינו מונע חיוב אם פרויקט ה-Google מחובר למסלול בתשלום.\n`);
  const bases = Object.keys(GROUND_TRUTH).map((f) => f.replace(/\.pdf$/, ""));
  let readCorrect = 0, nullCorrect = 0, totalRead = 0, totalNull = 0, wrong = 0;

  for (const base of bases) {
    const gt = (GROUND_TRUTH as Record<string, GT>)[base + ".pdf"]!;
    const bytes = readFileSync(join(dir, base + variant.suffix));
    const file = base + variant.suffix;
    const t0 = Date.now();
    let extraction;
    try {
      extraction = await extractPayslip(bytes, variant.mime);
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
      let ok: boolean;
      let note = "";
      const kind = expected === null ? "null" : "read";
      if (expected === null) {
        totalNull++;
        ok = gotVal === null; // חסר אמור לחזור null (לא הוסק אפס/אחוז)
        if (ok) nullCorrect++; else { wrong++; note = `(אמור null, חולץ ${gotVal})`; }
      } else if (gotVal === null) {
        totalRead++; ok = false; wrong++; note = `(אמור ${expected}, חולץ null - חוסר שגוי)`;
      } else {
        totalRead++;
        ok = approxEq(gotVal, expected as number, key);
        if (ok) readCorrect++; else { wrong++; note = `(אמור ${expected}, חולץ ${gotVal})`; }
      }
      console.log(`   [${ok ? "✓" : "✗"}] ${key} [${kind}]: ${gotVal ?? "null"} conf=${got?.confidence ?? "-"} ${note}`);
    }
    if (extraction.notes) console.log(`   notes: ${extraction.notes}`);
    console.log("");
  }

  const total = totalRead + totalNull;
  console.log(`=== סיכום (${variant.label}) ===`);
  console.log(`ערכים שנקראו נכון: ${readCorrect}/${totalRead}`);
  console.log(`שדות חסרים שהוחזרו נכון כ-null: ${nullCorrect}/${totalNull}`);
  console.log(`בדיקות שדה שעברו: ${readCorrect + nullCorrect} מתוך ${total}` + (wrong ? `  (${wrong} נכשלו)` : ""));
  process.exit(wrong === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });