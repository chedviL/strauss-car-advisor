// src/server/pdf/comparison-pdf.ts
// מצייר את מסמך ה-PDF של השוואת הנטו מתוך מודל תצוגה (ראו comparison-model.ts).
// A4, עברית RTL, שני עמודים:
//   עמוד 1: כותרת מותג, ההפרש החודשי בגדול, ושני כרטיסי "מצב" (היום / אחרי ההחלפה).
//   עמוד 2: טבלת הפירוט המלא, הנחות, והבהרות.
//
// המסמך מציג רק מה שנמסר לו במודל; אין כאן שום חישוב כספי.
// חצים וצורות נוצרים כוקטורים (הפונט אינו מכיל ▲/▼), פינות מעוגלות דרך נתיבי SVG.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import {
  drawCenter, drawLeft, drawParagraphRight, drawRight, paragraphHeight, rtlSafeFontkit,
  sanitizeForFont, textWidth, type TextStyle,
} from "./rtl.js";
import type { ComparisonPdfModel, PdfStateCard } from "./comparison-model.js";

// ─── קבועי עמוד ─────────────────────────────────────────────────────────────
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 40;                 // שוליים
const L = M;                  // קצה שמאל של התוכן
const R = PAGE_W - M;         // קצה ימין של התוכן (RTL: כאן מתחילים)
const CW = R - L;             // רוחב תוכן
/** המרה מ"מרחק מהקצה העליון" לקואורדינטת PDF (ציר Y עולה). */
const y = (top: number): number => PAGE_H - top;

// ─── פלטה (משקפת את :root ב-globals.css) ───────────────────────────────────
const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const C = {
  text: hex("#221d18"),
  body: hex("#4a433b"),
  muted: hex("#6b6258"),
  faint: hex("#a39a8f"),
  border: hex("#e7ded2"),
  surface: hex("#fffdfb"),
  surface2: hex("#faf7f2"),
  tint: hex("#efe9e1"),
  graphite: hex("#2b2b30"),
  gain: hex("#1f7a4d"),
  gainSoft: hex("#e9f3ec"),
  loss: hex("#a3362f"),
  lossSoft: hex("#f6eae8"),
  orange: hex("#e8622a"),
  orangeInk: hex("#a8431a"),
  orangeSoft: hex("#fbe9e0"),
  green: hex("#5bb24a"),
  teal: hex("#38b6c8"),
  tealInk: hex("#176c7a"),
  tealSoft: hex("#e2f3f6"),
  white: hex("#ffffff"),
};

// ─── נכסים (פונטים + לוגו) - נקראים מהדיסק פעם אחת לתהליך ───────────────────
interface Assets { regular: Uint8Array; semibold: Uint8Array; bold: Uint8Array; logo: Uint8Array }
let assetsCache: Assets | null = null;
function loadAssets(): Assets {
  if (assetsCache) return assetsCache;
  const fonts = join(process.cwd(), "assets", "fonts");
  assetsCache = {
    regular: readFileSync(join(fonts, "Assistant-Regular.ttf")),
    semibold: readFileSync(join(fonts, "Assistant-SemiBold.ttf")),
    bold: readFileSync(join(fonts, "Assistant-Bold.ttf")),
    // גרסה מוקטנת (360px, ~50KB) של הלוגו; המקור ב-public/brand שוקל ~590KB ואין צורך בו כאן.
    logo: readFileSync(join(process.cwd(), "assets", "brand", "strauss-logo-pdf.png")),
  };
  return assetsCache;
}

interface Fonts { regular: PDFFont; semibold: PDFFont; bold: PDFFont }

// ─── עזרי ציור ──────────────────────────────────────────────────────────────
function roundedRect(
  page: PDFPage, x: number, top: number, w: number, h: number, r: number,
  o: { fill?: RGB; stroke?: RGB; strokeWidth?: number },
): void {
  const path =
    `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} ` +
    `H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
  page.drawSvgPath(path, {
    x, y: y(top),
    ...(o.fill ? { color: o.fill } : {}),
    ...(o.stroke ? { borderColor: o.stroke, borderWidth: o.strokeWidth ?? 0.8 } : {}),
  });
}

function hline(page: PDFPage, x1: number, x2: number, top: number, color: RGB, thickness = 0.6): void {
  page.drawLine({ start: { x: x1, y: y(top) }, end: { x: x2, y: y(top) }, thickness, color });
}

function vline(page: PDFPage, x: number, top1: number, top2: number, color: RGB, thickness = 0.8): void {
  page.drawLine({ start: { x, y: y(top1) }, end: { x, y: y(top2) }, thickness, color });
}

/** משולש מלא (חץ עלייה/ירידה) סביב (cx, cy) בקואורדינטות PDF. */
function triangle(page: PDFPage, cx: number, cy: number, s: number, up: boolean, color: RGB): void {
  const path = up ? `M 0 ${-s} L ${s} ${s} L ${-s} ${s} Z` : `M 0 ${s} L ${s} ${-s} L ${-s} ${-s} Z`;
  page.drawSvgPath(path, { x: cx, y: cy, color });
}

/** מקטין גודל גופן עד שהטקסט נכנס ברוחב נתון (לא מתחת ל-min). */
function fitSize(text: string, font: PDFFont, start: number, min: number, maxWidth: number): number {
  let size = start;
  while (size > min && textWidth(text, { font, size, color: C.text }) > maxWidth) size -= 0.5;
  return size;
}

function brandStrip(page: PDFPage): void {
  const w = PAGE_W / 3;
  [C.orange, C.green, C.teal].forEach((color, i) => {
    page.drawRectangle({ x: i * w, y: PAGE_H - 5, width: w, height: 5, color });
  });
}

function footer(page: PDFPage, f: Fonts, pageNo: number, total: number, demo: boolean): void {
  hline(page, L, R, 806, C.border, 0.6);
  const s: TextStyle = { font: f.regular, size: 8.5, color: C.muted };
  drawRight(page, demo ? "יועץ הרכב של שטראוס · סביבת הדגמה" : "יועץ הרכב של שטראוס", R, y(822), s);
  drawLeft(page, `עמוד ${pageNo} מתוך ${total}`, L, y(822), s);
}

// ─── עמוד 1 ─────────────────────────────────────────────────────────────────
function drawHeader(page: PDFPage, f: Fonts, logo: PDFImage, m: ComparisonPdfModel): void {
  brandStrip(page);
  const logoH = 32;
  const logoW = (logo.width / logo.height) * logoH;
  page.drawImage(logo, { x: R - logoW, y: y(26 + logoH), width: logoW, height: logoH });
  const divX = R - logoW - 12;
  vline(page, divX, 30, 54, C.border, 1);
  drawRight(page, "יועץ הרכב", divX - 12, y(47), { font: f.bold, size: 13, color: C.graphite });

  drawLeft(page, `הופק ב-${m.generatedAtLabel}`, L, y(40), { font: f.regular, size: 10, color: C.muted });
  if (m.isDemo) {
    const label = "סביבת הדגמה";
    const style: TextStyle = { font: f.semibold, size: 9, color: C.orangeInk };
    const w = textWidth(label, style) + 20;
    roundedRect(page, L, 48, w, 17, 8.5, { fill: C.orangeSoft });
    drawCenter(page, label, L + w / 2, y(60), style);
  }
  hline(page, L, R, 76, C.border, 0.8);
}

function drawStateCard(
  page: PDFPage, f: Fonts, card: PdfStateCard, x: number, top: number, w: number, h: number, alt: boolean,
): void {
  roundedRect(page, x, top, w, h, 14, {
    fill: alt ? C.tealSoft : C.surface,
    stroke: alt ? C.teal : C.border,
    strokeWidth: alt ? 1.2 : 0.9,
  });
  const pad = 18;
  const right = x + w - pad;
  const left = x + pad;
  const inner = w - pad * 2;

  drawRight(page, card.title, right, y(top + 28), { font: f.bold, size: 11, color: alt ? C.tealInk : C.muted });
  const subSize = fitSize(card.subtitle, f.bold, 17, 11, inner);
  drawRight(page, card.subtitle, right, y(top + 53), { font: f.bold, size: subSize, color: C.graphite });
  drawRight(page, card.routeLabel, right, y(top + 71), { font: f.regular, size: 10, color: C.muted });

  hline(page, left, right, top + 86, alt ? C.teal : C.border, 0.6);

  drawRight(page, "נטו חודשי", right, y(top + 106), { font: f.regular, size: 10, color: C.muted });
  drawRight(page, card.net, right, y(top + 142), { font: f.bold, size: 31, color: C.graphite });

  hline(page, left, right, top + 158, alt ? C.teal : C.border, 0.6);

  let rowTop = top + 180;
  for (const row of card.rows) {
    const muted = row.muted === true;
    drawRight(page, row.label, right, y(rowTop), { font: f.regular, size: 10.5, color: C.muted });
    drawLeft(page, row.value, left, y(rowTop), { font: f.semibold, size: 10.5, color: muted ? C.faint : C.graphite });
    rowTop += 19;
  }
}

function drawPage1(page: PDFPage, f: Fonts, logo: PDFImage, m: ComparisonPdfModel): number {
  drawHeader(page, f, logo, m);

  drawRight(page, "השוואת נטו חודשי", R, y(118), { font: f.bold, size: 25, color: C.graphite });
  drawRight(page, "ההפרש בנטו החודשי בין המצב הנוכחי לבין החלופה שנבחרה", R, y(139), {
    font: f.regular, size: 11.5, color: C.muted,
  });

  let cursor = 160;

  if (m.staleWarning) {
    const s: TextStyle = { font: f.semibold, size: 10.5, color: C.loss };
    const textH = paragraphHeight(m.staleWarning, s, CW - 32, 15);
    const boxH = textH + 16;
    roundedRect(page, L, cursor, CW, boxH, 10, { fill: C.lossSoft, stroke: C.loss, strokeWidth: 0.6 });
    drawParagraphRight(page, m.staleWarning, R - 16, y(cursor + 8), CW - 32, s, 15);
    cursor += boxH + 14;
  }

  // ── גיבור: ההפרש החודשי ──
  const heroH = 112;
  const accent = m.gain ? C.gain : C.loss;
  const soft = m.gain ? C.gainSoft : C.lossSoft;
  roundedRect(page, L, cursor, CW, heroH, 16, { fill: soft, stroke: accent, strokeWidth: 0.9 });

  const padR = 26;
  drawRight(page, m.deltaLabel, R - padR, y(cursor + 38), { font: f.bold, size: 14, color: accent });
  const amountBase = y(cursor + 90);
  drawRight(page, m.deltaAmount, R - padR - 36, amountBase, { font: f.bold, size: 46, color: C.graphite });
  triangle(page, R - padR - 12, amountBase + 16, 12, m.gain, accent);

  const blockRight = L + 26 + 190;
  vline(page, blockRight + 20, cursor + 24, cursor + heroH - 24, accent, 0.6);
  const lab: TextStyle = { font: f.regular, size: 11, color: C.muted };
  const val: TextStyle = { font: f.bold, size: 14, color: C.graphite };
  drawRight(page, m.today.title, blockRight, y(cursor + 52), lab);
  drawLeft(page, m.today.net, L + 26, y(cursor + 52), val);
  drawRight(page, m.alternative.title, blockRight, y(cursor + 82), lab);
  drawLeft(page, m.alternative.net, L + 26, y(cursor + 82), val);
  cursor += heroH + 18;

  // ── שני כרטיסי מצב: "היום" בימין, "אחרי ההחלפה" בשמאל (RTL) ──
  const gap = 14;
  const cardW = (CW - gap) / 2;
  const maxRows = Math.max(m.today.rows.length, m.alternative.rows.length);
  const cardH = 180 + (Math.max(maxRows, 1) - 1) * 19 + 20;
  drawStateCard(page, f, m.today, R - cardW, cursor, cardW, cardH, false);
  drawStateCard(page, f, m.alternative, L, cursor, cardW, cardH, true);
  return cursor + cardH;
}

/** מצייר רשימת הנחות; מחזיר את הקצה התחתון (מרחק מלמעלה). */
function drawAssumptions(page: PDFPage, f: Fonts, items: string[], top: number): number {
  if (items.length === 0) return top;
  drawRight(page, "הנחות שהוזנו לחישוב", R, y(top + 14), { font: f.bold, size: 12.5, color: C.graphite });
  let cur = top + 28;
  const s: TextStyle = { font: f.regular, size: 10.5, color: C.body };
  for (const item of items) {
    const h = paragraphHeight(item, s, CW - 18, 15);
    page.drawCircle({ x: R - 4, y: y(cur + 7), size: 2.2, color: C.teal });
    drawParagraphRight(page, item, R - 16, y(cur), CW - 18, s, 15);
    cur += h + 5;
  }
  return cur;
}

// ─── עמוד 2 ─────────────────────────────────────────────────────────────────
function drawBreakdownTable(page: PDFPage, f: Fonts, m: ComparisonPdfModel, top: number): number {
  const c1 = R;               // עמודת "רכיב" (הימנית)
  const c2 = R - 255;         // עמודת "היום"
  const c3 = R - 385;         // עמודת "החלופה"
  const pad = 14;

  // כותרת הטבלה
  const headH = 30;
  roundedRect(page, L, top, CW, headH, 9, { fill: C.tint });
  const hs: TextStyle = { font: f.bold, size: 10.5, color: C.muted };
  drawRight(page, "רכיב", c1 - pad, y(top + 20), hs);
  drawRight(page, "היום", c2 - pad, y(top + 20), hs);
  drawRight(page, "אחרי ההחלפה", c3 - pad, y(top + 20), hs);

  let cur = top + headH;
  const rowH = 25;
  m.breakdown.forEach((row, i) => {
    if (i % 2 === 1) page.drawRectangle({ x: L, y: y(cur + rowH), width: CW, height: rowH, color: C.surface2 });
    const ink = row.muted ? C.faint : C.body;
    const inkVal = row.muted ? C.faint : C.graphite;
    drawRight(page, row.label, c1 - pad, y(cur + 17), { font: f.regular, size: 10.5, color: ink });
    drawRight(page, row.today, c2 - pad, y(cur + 17), { font: f.semibold, size: 10.5, color: inkVal });
    drawRight(page, row.alternative, c3 - pad, y(cur + 17), { font: f.semibold, size: 10.5, color: inkVal });
    hline(page, L, R, cur + rowH, C.border, 0.5);
    cur += rowH;
  });

  // שורת סיכום: נטו חודשי
  const sumH = 32;
  hline(page, L, R, cur, C.graphite, 1.2);
  page.drawRectangle({ x: L, y: y(cur + sumH), width: CW, height: sumH, color: C.gainSoft });
  const ss: TextStyle = { font: f.bold, size: 12, color: C.graphite };
  drawRight(page, "נטו חודשי", c1 - pad, y(cur + 21), ss);
  drawRight(page, m.today.net, c2 - pad, y(cur + 21), ss);
  drawRight(page, m.alternative.net, c3 - pad, y(cur + 21), ss);
  return cur + sumH;
}

function drawNotes(page: PDFPage, f: Fonts, m: ComparisonPdfModel, top: number): number {
  drawRight(page, "חשוב לדעת", R, y(top + 14), { font: f.bold, size: 12.5, color: C.graphite });
  const s: TextStyle = { font: f.regular, size: 10, color: C.body };
  const notes = [
    "המסמך הופק מ״יועץ הרכב של שטראוס״, סימולטור נטו לפי כללי האתגר (לוחות מס 2025, שווי שימוש 2026).",
    "זהו סימולטור: המספרים אינם תלוש שכר רשמי, אינם ייעוץ מס או פנסיה, ואינם אישור להקצאת רכב.",
    "התוצאה מבוססת על הנתונים שהוזנו בשיחה. שינוי בשכר, בהשתתפות או במסלול ישנה את הנטו.",
  ];
  let cur = top + 28;
  for (const n of notes) {
    const h = paragraphHeight(n, s, CW - 18, 15);
    page.drawCircle({ x: R - 4, y: y(cur + 7), size: 2, color: C.faint });
    drawParagraphRight(page, n, R - 16, y(cur), CW - 18, s, 15);
    cur += h + 5;
  }
  cur += 6;
  const meta = `מזהה השוואה ${m.meta.comparisonRef} · חושב ב-${m.meta.calculatedAtLabel} · גרסת נתונים ${m.meta.factsRevision} · מזהה כללים ${m.meta.rulesRef}`;
  drawRight(page, meta, R, y(cur + 10), { font: f.regular, size: 8.5, color: C.faint });
  return cur + 14;
}

// ─── API ────────────────────────────────────────────────────────────────────
export interface RenderResult {
  bytes: Uint8Array;
  /** תווים מהמודל שהפונט אינו מכיל (הוסרו מהציור). ריק = הכול נתמך. */
  unsupported: string[];
}

function collectStrings(v: unknown, out: string[]): void {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, out));
  else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach((x) => collectStrings(x, out));
}

export async function renderComparisonPdf(m: ComparisonPdfModel): Promise<RenderResult> {
  const assets = loadAssets();
  const doc = await PDFDocument.create();
  doc.registerFontkit(rtlSafeFontkit);
  const f: Fonts = {
    regular: await doc.embedFont(assets.regular, { subset: true }),
    semibold: await doc.embedFont(assets.semibold, { subset: true }),
    bold: await doc.embedFont(assets.bold, { subset: true }),
  };
  const logo = await doc.embedPng(assets.logo);

  doc.setTitle("השוואת נטו חודשי — יועץ הרכב של שטראוס", { showInWindowTitleBar: true });
  doc.setAuthor("יועץ הרכב של שטראוס");
  doc.setSubject("השוואת נטו חודשי בין המצב הנוכחי לחלופה");
  doc.setLanguage("he-IL");
  doc.setCreator("יועץ הרכב של שטראוס");
  doc.setProducer("יועץ הרכב של שטראוס");

  // תווים שהפונט אינו מכיל: מדווח למי שקרא במקום להדפיס ריבועים בשקט.
  const strings: string[] = [];
  collectStrings(m, strings);
  const unsupported = [...new Set(strings.flatMap((s) => sanitizeForFont(f.regular, s).dropped))];

  const total = 2;

  // עמוד 1 = סיכום שלם: כותרת, ההפרש, שני המצבים, ההנחות וההבהרות. הקורא מקבל את
  // התמונה המלאה והאחריות בעמוד אחד; עמוד 2 הוא נספח הפירוט בלבד.
  const p1 = doc.addPage([PAGE_W, PAGE_H]);
  let cur = drawPage1(p1, f, logo, m) + 24;
  if (m.assumptions.length > 0) cur = drawAssumptions(p1, f, m.assumptions, cur) + 16;
  drawNotes(p1, f, m, cur);
  footer(p1, f, 1, total, m.isDemo);

  const p2 = doc.addPage([PAGE_W, PAGE_H]);
  brandStrip(p2);
  drawRight(p2, "פירוט מלא של הרכיבים", R, y(60), { font: f.bold, size: 21, color: C.graphite });
  drawRight(p2, "כל הסכומים חודשיים, כפי שחושבו במנוע החישוב. קו מקף (—) מציין סכום אפס.", R, y(80), {
    font: f.regular, size: 11, color: C.muted,
  });
  drawBreakdownTable(p2, f, m, 100);
  footer(p2, f, 2, total, m.isDemo);

  return { bytes: await doc.save(), unsupported };
}
