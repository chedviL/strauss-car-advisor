// src/server/pdf/rtl.ts
// טקסט עברי (RTL) ב-PDF דרך pdf-lib. pdf-lib מצייר גליפים משמאל לימין בסדר שקיבל
// ואינו מבצע bidi, ולכן אנו ממירים כל שורה מסדר לוגי לסדר *ויזואלי* לפני הציור.
// עברית אינה דורשת shaping (אין חיבור אותיות) - רק סידור מחדש, וזה מה ש-bidi-js עושה
// (אלגוריתם ה-UBA של Unicode, כולל מספרים בתוך טקסט עברי והחלפת סוגריים הפוכים).
//
// עקרונות:
//  - שבירת שורות נעשית על הטקסט *הלוגי* (לפי מילים), ורק אחר כך כל שורה מסודרת
//    ויזואלית. סידור לפני שבירה היה מערבב את סדר המילים בין שורות.
//  - תו שהפונט לא מכיל לא יודפס כריבוע ריק בשקט: מוסר ומדווח למי שקרא.
//  - מודול טהור: ללא גישה לדיסק/רשת/מסד.

import bidiFactory from "bidi-js";
import fontkit from "@pdf-lib/fontkit";
import type { PDFFont, PDFPage, RGB } from "pdf-lib";

const bidi = bidiFactory();

/**
 * fontkit שנמסר ל-pdf-lib (registerFontkit) כשכל פונט שהוא יוצר כופה כיוון "ltr".
 *
 * למה: ברירת המחדל של fontkit היא להפוך בעצמו את סדר הגליפים של כל ריצה שמזוהה
 * כעברית (direction=rtl). אנחנו כבר מסדרים כל שורה ויזואלית עם bidi-js, ולכן ההיפוך
 * של fontkit הוא היפוך *כפול*: אותיות הפכו בתוך מילים, ומספרים/אנגלית ("661" -> "166",
 * "BYD ATTO 3" -> "3 OTTA DYB") התהפכו. כפיית "ltr" אומרת ל-fontkit להניח את הגליפים
 * בדיוק בסדר שקיבל, משמאל לימין - וזה מה ש-pdf-lib מצייר.
 *
 * pdf-lib קורא ל-font.layout(text) בלי פרמטר כיוון ואין דרך להעביר אותו, ולכן עוטפים.
 * אומת בעין: scripts/sim/rtl-smoke.ts מפיק PDF שבו "661" נשאר "661", "BYD ATTO 3" נשאר
 * "BYD ATTO 3", ותאריכים וסוגריים בכיוון הנכון (בלי העטיפה הם יצאו הפוכים).
 */
export const rtlSafeFontkit: typeof fontkit = {
  ...(fontkit as object),
  create: (...args: Parameters<typeof fontkit.create>) => {
    const font = fontkit.create(...args) as unknown as {
      layout: (...a: unknown[]) => unknown;
    };
    const originalLayout = font.layout.bind(font);
    font.layout = (string: unknown, features?: unknown, script?: unknown, language?: unknown) =>
      originalLayout(string, features, script, language, "ltr");
    return font as never;
  },
} as typeof fontkit;

/** ממיר מחרוזת מסדר לוגי לסדר ויזואלי (בסיס RTL), מוכן לציור משמאל לימין. */
export function toVisual(logical: string): string {
  if (logical === "") return "";
  const levels = bidi.getEmbeddingLevels(logical, "rtl");
  return bidi.getReorderedString(logical, levels);
}

// קבוצת תווים נתמכת לכל פונט (חישוב חד-פעמי; getCharacterSet יקר).
const supportCache = new WeakMap<PDFFont, Set<number>>();
function supportedSet(font: PDFFont): Set<number> {
  let s = supportCache.get(font);
  if (!s) {
    s = new Set(font.getCharacterSet());
    supportCache.set(font, s);
  }
  return s;
}

export interface SanitizeResult {
  text: string;
  /** תווים שהוסרו כי הפונט אינו מכיל אותם (ללא כפילויות). */
  dropped: string[];
}

/** מסיר תווים שאין להם גליף בפונט. רווחים ותווי בקרה מותרים תמיד. */
export function sanitizeForFont(font: PDFFont, text: string): SanitizeResult {
  const set = supportedSet(font);
  const dropped = new Set<string>();
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x20 || cp === 0xa0 || set.has(cp)) out += ch;
    else dropped.add(ch);
  }
  return { text: out, dropped: [...dropped] };
}

/** האם הפונט מכיל את כל התווים (לבדיקות/אימות). */
export function fontCovers(font: PDFFont, text: string): boolean {
  return sanitizeForFont(font, text).dropped.length === 0;
}

export interface TextStyle {
  font: PDFFont;
  size: number;
  color: RGB;
}

/** מכין מחרוזת לציור: מנקה תווים לא נתמכים ומסדר ויזואלית. */
export function prepare(text: string, font: PDFFont): string {
  return toVisual(sanitizeForFont(font, text).text);
}

/** רוחב הטקסט כפי שיצויר (סדר ויזואלי), בנקודות. */
export function textWidth(text: string, style: TextStyle): number {
  return style.font.widthOfTextAtSize(prepare(text, style.font), style.size);
}

/**
 * שובר טקסט לוגי לשורות לפי רוחב מקסימלי. מילה ארוכה מהרוחב נשברת לפי תווים
 * (נדיר: למשל מחרוזת ללא רווחים). שורה ריקה בטקסט המקור נשמרת כמעבר פסקה.
 */
export function wrapLogical(text: string, style: TextStyle, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/[ \t]+/).filter((w) => w !== "");
    if (words.length === 0) { lines.push(""); continue; }
    let line = "";
    const flush = () => { if (line !== "") { lines.push(line); line = ""; } };
    for (const w of words) {
      const cand = line === "" ? w : `${line} ${w}`;
      if (textWidth(cand, style) <= maxWidth) { line = cand; continue; }
      flush();
      if (textWidth(w, style) <= maxWidth) { line = w; continue; }
      // מילה ארוכה מהשורה: שבירה לפי תווים.
      let chunk = "";
      for (const ch of w) {
        if (chunk !== "" && textWidth(chunk + ch, style) > maxWidth) { lines.push(chunk); chunk = ch; }
        else chunk += ch;
      }
      line = chunk;
    }
    flush();
  }
  return lines;
}

/** מצייר שורה מיושרת לימין (קצה ימין = right). מחזיר את הרוחב שצויר. */
export function drawRight(page: PDFPage, text: string, right: number, y: number, style: TextStyle): number {
  const visual = prepare(text, style.font);
  const w = style.font.widthOfTextAtSize(visual, style.size);
  if (visual !== "") page.drawText(visual, { x: right - w, y, size: style.size, font: style.font, color: style.color });
  return w;
}

/** מצייר שורה מיושרת לשמאל (קצה שמאל = left). */
export function drawLeft(page: PDFPage, text: string, left: number, y: number, style: TextStyle): number {
  const visual = prepare(text, style.font);
  const w = style.font.widthOfTextAtSize(visual, style.size);
  if (visual !== "") page.drawText(visual, { x: left, y, size: style.size, font: style.font, color: style.color });
  return w;
}

/** מצייר שורה ממורכזת סביב cx. */
export function drawCenter(page: PDFPage, text: string, cx: number, y: number, style: TextStyle): number {
  const visual = prepare(text, style.font);
  const w = style.font.widthOfTextAtSize(visual, style.size);
  if (visual !== "") page.drawText(visual, { x: cx - w / 2, y, size: style.size, font: style.font, color: style.color });
  return w;
}

export interface ParagraphResult {
  /** כמה שורות צוירו. */
  lines: number;
  /** גובה כולל שנצרך (lines * lineHeight). */
  height: number;
}

/**
 * מצייר פסקה מיושרת לימין החל מ-topY (קו הבסיס של השורה הראשונה = topY - size).
 * מחזיר את הגובה שנצרך, כדי שהקורא ימשיך מתחתיה.
 */
export function drawParagraphRight(
  page: PDFPage, text: string, right: number, topY: number, maxWidth: number, style: TextStyle, lineHeight: number,
): ParagraphResult {
  const lines = wrapLogical(text, style, maxWidth);
  let y = topY - style.size;
  for (const ln of lines) {
    drawRight(page, ln, right, y, style);
    y -= lineHeight;
  }
  return { lines: lines.length, height: lines.length * lineHeight };
}

/** גובה פסקה בלי לצייר (לחישוב פריסה מראש). */
export function paragraphHeight(text: string, style: TextStyle, maxWidth: number, lineHeight: number): number {
  return wrapLogical(text, style, maxWidth).length * lineHeight;
}
