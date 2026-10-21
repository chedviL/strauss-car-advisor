// scripts/sim/rtl-smoke.ts
// בדיקת עשן חזותית לסידור RTL ב-PDF: מקרים קשים של עברית עם מספרים, ₪, סוגריים
// ושמות רכב באנגלית. מפיק PDF לתיקיית טמפ לבדיקה בעין (רנדור ל-PNG).
// הרצה: npx tsx scripts/sim/rtl-smoke.ts <out.pdf>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import { drawRight, drawParagraphRight, sanitizeForFont, rtlSafeFontkit } from "../../src/server/pdf/rtl.js";

const cases = [
  "יותר בנטו בכל חודש: 661 ₪",
  "הנטו החודשי יגדל ב-1,234 ₪ (לפי הכללים)",
  "BYD ATTO 3 — נטו 11,693 ₪",
  "היום: מאזדה 3 (קבוצה ב')",
  "הפרשת עובד לקרן השתלמות",
  "שווי שימוש 3,130 ₪ · מס + ב.לאומי 4,210 ₪",
  "תאריך: 21.10.2026 · גרסה 7",
  "▲ וגם ✓ — תווים שאולי חסרים בפונט",
];

async function main() {
  const out = process.argv[2];
  if (!out) { console.error("usage: tsx scripts/sim/rtl-smoke.ts <out.pdf>"); process.exit(1); }

  const fontsDir = join(process.cwd(), "assets", "fonts");
  const doc = await PDFDocument.create();
  doc.registerFontkit(rtlSafeFontkit);
  const regular = await doc.embedFont(readFileSync(join(fontsDir, "Assistant-Regular.ttf")), { subset: true });
  const bold = await doc.embedFont(readFileSync(join(fontsDir, "Assistant-Bold.ttf")), { subset: true });
  const page = doc.addPage([595.28, 841.89]);
  const right = 555;
  const ink = rgb(0.13, 0.11, 0.09);

  let y = 790;
  drawRight(page, "בדיקת סידור עברית (Regular / Bold)", right, y, { font: bold, size: 16, color: ink });
  y -= 34;
  const dropped: string[] = [];
  for (const c of cases) {
    drawRight(page, c, right, y, { font: regular, size: 13, color: ink });
    const s = sanitizeForFont(regular, c);
    if (s.dropped.length) dropped.push(`${JSON.stringify(c)} -> missing: ${s.dropped.join(" ")}`);
    y -= 26;
  }
  y -= 10;
  const para = "זהו מסמך הדגמה של שבירת שורות בעברית עם מספרים כמו 12,500 ₪ ושמות באנגלית כמו TOYOTA COROLLA CROSS בתוך פסקה ארוכה, כדי לוודא שהמילים נשברות לפי הסדר הלוגי ולא מתערבבות בין השורות.";
  const res = drawParagraphRight(page, para, right, y, 300, { font: regular, size: 12, color: ink }, 19);
  console.log("paragraph lines:", res.lines);
  writeFileSync(out, await doc.save());
  console.log("wrote", out);
  console.log(dropped.length ? "UNSUPPORTED CHARS:\n" + dropped.join("\n") : "all chars supported");
}
main().catch((e) => { console.error(e); process.exit(1); });
