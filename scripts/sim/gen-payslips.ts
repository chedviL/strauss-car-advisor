// scripts/sim/gen-payslips.ts
// יוצר 3 תלושים סינתטיים (PDF) עם ground-truth ידוע, לבדיקת חילוץ. ללא PII אמיתי.
// שלושה תרחישים: (1) מלא עם אחוזים מפורשים; (2) ניכויים כסכום בלבד (בלי אחוז) ->
// אין להסיק אחוז; (3) מלכודת ברוטו-כולל/בסיס-מס/נטו -> לבחור שכר בסיס.
// הרצה: npx tsx scripts/sim/gen-payslips.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { GROUND_TRUTH } from "./payslip-truth.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../../tests/fixtures/payslips");
mkdirSync(outDir, { recursive: true });
const fontBytes = readFileSync(join(outDir, "_hebfont.ttf"));

// RTL: pdf-lib אינו עושה bidi; נכתוב כל שורה כ"תווים הפוכים" כדי שתוצג נכון מימין לשמאל.
// מספרים נשארים כפי שהם (הופכים את כל השורה, אז נהפוך ספרתית חזרה בתוך הסוגריים).
function rev(s: string): string { return [...s].reverse().join(""); }

async function makePdf(lines: string[], file: string): Promise<void> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const page = doc.addPage([595, 842]); // A4
  const right = 545;
  let y = 790;
  for (const line of lines) {
    const t = rev(line);
    const w = font.widthOfTextAtSize(t, 13);
    page.drawText(t, { x: right - w, y, size: 13, font, color: rgb(0.1, 0.1, 0.12) });
    y -= 26;
  }
  const bytes = await doc.save();
  writeFileSync(join(outDir, file), bytes);
}

void GROUND_TRUTH;

async function main() {
  // תלוש 1: מלא, אחוזים מפורשים.
  await makePdf([
    "תלוש שכר - ינואר 2026",
    "שם: נועה (לדוגמה)   ת.ז: 000000000",
    "--------------------------------------",
    "שכר בסיס: 18,500 ש\"ח",
    "עמלות: 0 ש\"ח",
    "בונוס: 0 ש\"ח",
    "הפרשת עובד לפנסיה: 6%",
    "הפרשת עובד לקרן השתלמות: 2.5%",
    "נקודות זיכוי: 2.75",
    "נטו לתשלום: 13,920 ש\"ח",
  ], "payslip-1.pdf");

  // תלוש 2: ניכויים כסכום בלבד (בלי אחוז) -> אין להסיק אחוז (pension/training=null).
  await makePdf([
    "תלוש שכר - פברואר 2026",
    "שם: עובד/ת לדוגמה",
    "--------------------------------------",
    "שכר בסיס: 14,200 ש\"ח",
    "עמלות: 1,200 ש\"ח",
    "ניכוי פנסיה: 852 ש\"ח",
    "ניכוי קרן השתלמות: 355 ש\"ח",
    "נקודות זיכוי: 2.25",
    "נטו לתשלום: 11,730 ש\"ח",
  ], "payslip-2.pdf");

  // תלוש 3: מלכודת ברוטו-כולל/בסיס-מס/נטו -> לבחור שכר בסיס, לא total/net.
  await makePdf([
    "תלוש שכר - מרץ 2026",
    "שם: עובד/ת לדוגמה",
    "--------------------------------------",
    "שכר בסיס: 16,000 ש\"ח",
    "בונוס: 3,000 ש\"ח",
    "ברוטו כולל: 19,000 ש\"ח",
    "בסיס מס: 22,100 ש\"ח",
    "הפרשת עובד לפנסיה: 7%",
    "הפרשת עובד לקרן השתלמות: 2.5%",
    "נטו לתשלום: 13,450 ש\"ח",
  ], "payslip-3.pdf");

  console.log("3 payslips written to", outDir);
}
main().catch((e) => { console.error(e); process.exit(1); });