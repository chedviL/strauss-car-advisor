// scripts/sim/gen-payslip-scans.ts
// יוצר "סריקות" (תמונות PNG ללא שכבת טקסט) מתוכן התלושים - לבדיקת OCR/ראייה אמיתית.
// שתי איכויות: clear (חדה) ו-degraded (טשטוש+רעש+רזולוציה נמוכה+הטיה קלה) כמו צילום גרוע.
// אותם ערכי אמת כמו ה-PDF. הרצה: npx tsx scripts/sim/gen-payslip-scans.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../../tests/fixtures/payslips");
mkdirSync(outDir, { recursive: true });
const fontB64 = readFileSync(join(outDir, "_hebfont.ttf")).toString("base64");

// תוכן התלושים (זהה ל-gen-payslips, אך מרונדר כתמונה ללא טקסט).
const DOCS: Record<string, string[]> = {
  "payslip-1": [
    "תלוש שכר - ינואר 2026", "שם: נועה (לדוגמה)", "",
    "שכר בסיס: 18,500 ש\"ח", "עמלות: 0 ש\"ח", "בונוס: 0 ש\"ח",
    "הפרשת עובד לפנסיה: 6%", "הפרשת עובד לקרן השתלמות: 2.5%",
    "נקודות זיכוי: 2.75", "נטו לתשלום: 13,920 ש\"ח",
  ],
  "payslip-2": [
    "תלוש שכר - פברואר 2026", "שם: עובד/ת לדוגמה", "",
    "שכר בסיס: 14,200 ש\"ח", "עמלות: 1,200 ש\"ח",
    "ניכוי פנסיה: 852 ש\"ח", "ניכוי קרן השתלמות: 355 ש\"ח",
    "נקודות זיכוי: 2.25", "נטו לתשלום: 11,730 ש\"ח",
  ],
  "payslip-3": [
    "תלוש שכר - מרץ 2026", "שם: עובד/ת לדוגמה", "",
    "שכר בסיס: 16,000 ש\"ח", "בונוס: 3,000 ש\"ח",
    "ברוטו כולל: 19,000 ש\"ח", "בסיס מס: 22,100 ש\"ח",
    "הפרשת עובד לפנסיה: 7%", "הפרשת עובד לקרן השתלמות: 2.5%",
    "נטו לתשלום: 13,450 ש\"ח",
  ],
};

function svg(lines: string[], w = 720, h = 900): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const rows = lines.map((l, i) => `<text x="${w - 40}" y="${90 + i * 60}" font-family="Heb" font-size="26" fill="#1a1a22" text-anchor="end">${esc(l)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><style>@font-face{font-family:'Heb';src:url(data:font/ttf;base64,${fontB64}) format('truetype');}</style></defs>
    <rect width="100%" height="100%" fill="#fbfaf7"/>
    <rect x="24" y="24" width="${w - 48}" height="${h - 48}" fill="none" stroke="#ddd" stroke-width="2"/>
    ${rows}
  </svg>`;
}

async function main() {
  for (const [id, lines] of Object.entries(DOCS)) {
    const buf = Buffer.from(svg(lines));
    // clear: רינדור חד ל-PNG (ללא שכבת טקסט - תמונה בלבד).
    await sharp(buf, { density: 150 }).png().toFile(join(outDir, `${id}-scan-clear.png`));
    // degraded: רזולוציה נמוכה + טשטוש + רעש + הטיה קלה (צילום/סריקה גרועים).
    await sharp(buf, { density: 150 })
      .resize(520)                                  // רזולוציה נמוכה יותר
      .rotate(1.5, { background: "#fbfaf7" })        // הטיה קלה
      .blur(0.8)                                     // טשטוש
      .modulate({ brightness: 0.94 })                // חשיפה מעט נמוכה
      .jpeg({ quality: 55 })                          // ארטיפקטים של דחיסה
      .toFile(join(outDir, `${id}-scan-degraded.jpg`));
  }
  console.log("scans written (clear PNG + degraded JPG) to", outDir);
}
main().catch((e) => { console.error(e); process.exit(1); });