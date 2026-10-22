import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderComparisonPdf } from "../../src/server/pdf/comparison-pdf.js";
import type { ComparisonPdfModel } from "../../src/server/pdf/comparison-model.js";

const model: ComparisonPdfModel = {
  generatedAtLabel: "22.10.2026",
  isDemo: true,
  gain: true,
  deltaLabel: "יותר בנטו בכל חודש",
  deltaAmount: "250 ₪",
  today: {
    title: "היום",
    subtitle: "רכב נוכחי",
    routeLabel: "רכב חברה",
    net: "12,000 ₪",
    rows: [{ label: "שווי שימוש", value: "3,000 ₪" }],
  },
  alternative: {
    title: "אחרי ההחלפה",
    subtitle: "רכב חלופי",
    routeLabel: "רכב חברה",
    net: "12,250 ₪",
    rows: [{ label: "שווי שימוש", value: "2,500 ₪" }],
  },
  breakdown: [{ label: "נטו", today: "12,000 ₪", alternative: "12,250 ₪", muted: false }],
  assumptions: [],
  staleWarning: null,
  meta: {
    comparisonRef: "12345678",
    calculatedAtLabel: "22.10.2026",
    factsRevision: 1,
    rulesRef: "abcdef12",
  },
};

describe("יצירת PDF השוואה", () => {
  it("מרנדר PDF אמיתי בן שני עמודים עם גופנים ונכסי המותג", async () => {
    const rendered = await renderComparisonPdf(model);
    expect(new TextDecoder().decode(rendered.bytes.slice(0, 5))).toBe("%PDF-");
    expect(rendered.unsupported).toEqual([]);

    const pdf = await PDFDocument.load(rendered.bytes);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getTitle()).toContain("השוואת נטו");
  });
});