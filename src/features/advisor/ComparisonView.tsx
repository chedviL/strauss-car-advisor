// src/features/advisor/ComparisonView.tsx
"use client";
// תצוגת השוואה: כרטיס לצד השיחה. סכומים מפלט המנוע בלבד.
// הפרש נטו עם סימון שאינו צבע-בלבד (חץ + מילה). "חלופה ממתינה" כשחסר נתון.

import { useState, useTransition } from "react";
import { clearActiveInquiry } from "../../app/inquiry-actions.js";
import { isComparisonStale } from "../../domain/calculation/staleness.js";
import { LightTrail } from "../brand/LightTrail.js";
import type { CaseState } from "../../domain/contracts/case.js";
import type { NetBreakdown, ScenarioResult } from "../../domain/contracts/types.js";
import { BREAKDOWN_LABELS } from "../../domain/calculation/breakdown-labels.js";
import type { SampleEmployee } from "../../../data/source/sample-employees.js";

function shekel(s: string | number): string {
  const n = typeof s === "string" ? Number(s) : s;
  return new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 }).format(n) + " ₪";
}

export function ComparisonView({
  state,
  employee,
  vehicleNames = {},
}: {
  state: CaseState;
  employee: SampleEmployee | null;
  vehicleNames?: Record<string, string>;
}) {
  const [pending, startTransition] = useTransition();
  const cmp = state.latestComparison!;

  // הורדת סיכום PDF. ה-PDF נוצר בשרת מההשוואה השמורה (אותם סכומים שבכרטיס); כאן רק
  // מבקשים אותו ומורידים. שולחים את מזהה ההשוואה המוצגת, כדי שהשרת יסרב (409) אם
  // בינתיים חושבה אחרת - ולא יורד מסמך שאינו תואם למה שרואים על המסך.
  const [pdfPhase, setPdfPhase] = useState<"idle" | "loading" | "error">("idle");
  const [pdfError, setPdfError] = useState<{ message: string; blockedUrl?: string } | null>(null);

  async function downloadPdf() {
    if (pdfPhase === "loading") return;
    setPdfPhase("loading");
    setPdfError(null);
    const qs = new URLSearchParams({ c: state.case.id, cmp: cmp.id });
    const downloadUrl = `${window.location.origin}/api/comparison-pdf?${qs.toString()}`;
    try {
      const res = await fetch(downloadUrl);
      const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
      if (!res.ok) {
        const body = await res.clone().text().catch(() => "");
        const data = (() => { try { return JSON.parse(body) as { error?: string; errorId?: string }; } catch { return {}; } })();
        setPdfPhase("error");
        if (/netfree|net-free|נטפרי/i.test(`${res.url} ${body}`)) {
          setPdfError({
            message: "הורדת הקובץ נחסמה על ידי נטפרי. אפשר לשלוח את הקישור לבדיקה. ההשוואה שלך נשמרה וניתן לצפות בה באתר.",
            blockedUrl: downloadUrl,
          });
        } else {
          setPdfError({
            message: data.errorId
              ? `${data.error ?? "יצירת המסמך נכשלה."} (מזהה תקלה: ${data.errorId})`
              : data.error ?? "ההורדה נכשלה. אפשר לנסות שוב.",
          });
        }
        return;
      }
      if (!contentType.includes("application/pdf")) {
        const body = await res.clone().text().catch(() => "");
        setPdfPhase("error");
        setPdfError(/netfree|net-free|נטפרי/i.test(`${res.url} ${body}`)
          ? {
              message: "הורדת הקובץ נחסמה על ידי נטפרי. אפשר לשלוח את הקישור לבדיקה. ההשוואה שלך נשמרה וניתן לצפות בה באתר.",
              blockedUrl: downloadUrl,
            }
          : { message: "השרת לא החזיר קובץ PDF תקין. ההשוואה נשמרה באתר; אפשר לנסות שוב מאוחר יותר." });
        return;
      }
      // שם הקובץ מהשרת (filename* בקידוד RFC 5987), עם גיבוי אם הכותרת חסרה.
      const disp = res.headers.get("content-disposition") ?? "";
      const m = /filename\*=UTF-8''([^;]+)/i.exec(disp);
      let fileName = "strauss-net-comparison.pdf";
      if (m?.[1]) { try { fileName = decodeURIComponent(m[1]); } catch { /* נשארים עם הגיבוי */ } }

      const blobUrl = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
      setPdfPhase("idle");
    } catch {
      setPdfPhase("error");
      setPdfError({
        message: "ההורדה לא הושלמה. ההשוואה נשמרה באתר; אפשר לנסות שוב או לשלוח את קישור ההורדה לבדיקה.",
        blockedUrl: downloadUrl,
      });
    }
  }
  const pdfLoading = pdfPhase === "loading";
  const baseNet = Number(cmp.result.baseline.netDisplay);
  const altNet = Number(cmp.result.alternative.netDisplay);
  const delta = cmp.result.netDeltaDisplay;
  const gain = delta >= 0;

  const baseline = state.scenarios.find((s) => s.role === "baseline")!;
  const alternative = state.scenarios.find((s) => s.role === "alternative")!;

  // תוצאה מיושנת: גרסת-העובדות בהשוואה שונה מהנוכחית.
  const stale = isComparisonStale(state);
  // הנחות (למשל השתתפות ברירת-מחדל) שזרמו לתוצאה.
  const assumptions = [
    ...(cmp.result.baseline.assumptions ?? []),
    ...(cmp.result.alternative.assumptions ?? []),
  ].filter((v, i, a) => a.indexOf(v) === i);

  const nameOf = (code: string | null, fallback: string) => (code ? (vehicleNames[code] ?? code) : fallback);
  const baseTitle = baseline.route === "waiver" ? "ויתור על רכב" : nameOf(baseline.vehicleCode, "המצב הנוכחי");
  const altTitle = alternative.route === "waiver" ? "ויתור על רכב" : nameOf(alternative.vehicleCode, "החלופה");

  // תמצית הכרחית לגב האריח (hover) - רק הרכיבים שמשנים את הנטו.
  const essentials = (r: ScenarioResult & { netDisplay: string }, scen: { maintenanceAllowance: number; participation: number | null }) => [
    { label: "שווי שימוש", value: shekelFromBreakdown(r.breakdown.taxableIncome, r.breakdown.cashSalary) },
    { label: "מס + ב.לאומי", value: fmt(sum(r.breakdown.incomeTax, sum(r.breakdown.nationalInsurance, r.breakdown.health))) },
    { label: "הפרשות", value: fmt(sum(r.breakdown.pensionEmployee, r.breakdown.trainingEmployee)) },
    ...(scen.maintenanceAllowance > 0 ? [{ label: "אחזקת רכב", value: fmt(String(scen.maintenanceAllowance)) }] : []),
  ];

  return (
    <section className="cmp-card" aria-label="השוואת נטו חודשי">
      {/* שורת כותרת קומפקטית + המשמעות למשתמש */}
      <div className="cmp-top">
        <span className="cmp-kicker">
          <LightTrail mode="result" variant="inline" className="cmp-kicker-trail" />
          השוואת נטו חודשי
        </span>
        <span className="cmp-top-actions">
          {/* הורדת סיכום PDF: אייקון עדין בלבד; "הורדת סיכום PDF" בבועה במעבר עכבר/מיקוד
              (אותו עיצוב כמו "דבר איתי"). הבועה נפתחת מתחת לכפתור כי הוא קרוב לקצה הכרטיס
              ואזור הגלילה היה חותך בועה שנפתחת הצידה. */}
          <button
            type="button"
            className="icon-btn has-tip cmp-pdf-btn"
            aria-label={pdfLoading ? "מכין את המסמך להורדה" : "הורדת סיכום ההשוואה כקובץ PDF"}
            aria-busy={pdfLoading}
            disabled={pdfLoading}
            onClick={downloadPdf}
          >
            {pdfLoading ? <DownloadSpinner /> : <DownloadIcon />}
            {!pdfLoading && <span className="ui-tip ui-tip-below" aria-hidden="true">הורדת סיכום PDF</span>}
          </button>
          <button className="btn btn-ghost" disabled={pending} onClick={() => startTransition(async () => {
              // הבירור הפעיל נקבע לפי ?c= ב-URL (לא לפי עוגייה): מנקים את המצביע וטוענים "/" נקי.
              try { await clearActiveInquiry(); } finally { window.location.assign("/"); }
            })} style={{ fontSize: "var(--font-sm)" }}>
            התחל מחדש
          </button>
        </span>
      </div>

      {pdfPhase === "error" && (
        <div role="alert" className="cmp-pdf-error">
          {pdfError?.message}
          {pdfError?.blockedUrl && (
            <a href={pdfError.blockedUrl} target="_blank" rel="noopener noreferrer">פתיחת קישור ההורדה לבדיקה</a>
          )}
        </div>
      )}

      {/* ההפרש - המשמעות + מספר, בשורה אחת קומפקטית */}
      <div role="status" className={`cmp-delta ${gain ? "is-gain" : "is-loss"}`}>
        <span className="cmp-delta-label">{gain ? "יותר בנטו בכל חודש" : "פחות בנטו בכל חודש"}</span>
        <span className="cmp-delta-num"><span aria-hidden="true">{gain ? "▲ " : "▼ "}</span>{shekel(Math.abs(delta))}</span>
      </div>

      {/* שני אריחים מתהפכים: היום / אחרי ההחלפה. hover -> תמצית הכרחית. */}
      <div className="cmp-tiles">
        <FlipTile title="היום" subtitle={baseTitle} net={shekel(baseNet)} rows={essentials(cmp.result.baseline, baseline)} />
        <FlipTile title="אחרי ההחלפה" subtitle={altTitle} net={shekel(altNet)} rows={essentials(cmp.result.alternative, alternative)} highlight />
      </div>

      {/* הנחות ותוצאה מיושנת - עדין וברור */}
      {(stale || assumptions.length > 0) && (
        <div style={{ marginTop: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          {stale && (
            <div style={{ fontSize: "var(--font-sm)", color: "var(--color-loss)", background: "var(--color-loss-soft)", borderRadius: "var(--radius-sm)", padding: "var(--space-2) var(--space-3)" }}>
              הנתונים השתנו מאז החישוב — כדאי לחשב מחדש לפני הסתמכות.
            </div>
          )}
          {assumptions.map((a, i) => (
            <div key={i} style={{ fontSize: "var(--font-sm)", color: "var(--color-muted)" }}>· {a}</div>
          ))}
        </div>
      )}

      <details style={{ marginTop: "var(--space-3)" }}>
        <summary style={{ cursor: "pointer", color: "var(--color-primary)", fontWeight: 600, fontSize: "var(--font-sm)" }}>פירוט מלא של הרכיבים</summary>
        <BreakdownTable base={cmp.result.baseline.breakdown} alt={cmp.result.alternative.breakdown} />
      </details>
    </section>
  );
}

// אריח מתהפך: פנים = תווית + נטו; גב (hover/focus) = תמצית הכרחית בלבד.
function FlipTile({
  title, subtitle, net, rows, highlight,
}: {
  title: string; subtitle: string; net: string;
  rows: Array<{ label: string; value: string }>;
  highlight?: boolean;
}) {
  return (
    <div className={`cmp-tile ${highlight ? "is-alt" : ""}`.trim()} tabIndex={0} aria-label={`${title}: ${subtitle}, נטו ${net}`}>
      <div className="cmp-tile-inner">
        {/* פנים */}
        <div className="cmp-tile-face cmp-tile-front">
          <div className="cmp-tile-title">{title}</div>
          <div className="cmp-tile-sub">{subtitle}</div>
          <div className="cmp-tile-net">{net}</div>
        </div>
        {/* גב - תמצית */}
        <div className="cmp-tile-face cmp-tile-back">
          {rows.map((r, i) => (
            <div key={i} className="cmp-tile-row">
              <span>{r.label}</span>
              <span style={{ unicodeBidi: "plaintext", fontVariantNumeric: "tabular-nums" }}>{r.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BreakdownTable({ base, alt }: { base: NetBreakdown; alt: NetBreakdown }) {
  // מקור אמת יחיד לשמות הרכיבים (זהה למה שהמודל מקבל מהכלים).
  const labels = BREAKDOWN_LABELS as Record<string, string>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "var(--space-2)", fontSize: "0.85rem" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "start" }}>רכיב</th>
          <th style={{ textAlign: "start" }}>היום</th>
          <th style={{ textAlign: "start" }}>חלופה</th>
        </tr>
      </thead>
      <tbody>
        {(Object.keys(labels) as Array<keyof NetBreakdown>).map((k) => (
          <tr key={k}>
            <td style={{ color: "var(--color-muted)" }}>{labels[k as string]}</td>
            <td>{fmt(base[k] ?? "0")}</td>
            <td>{fmt(alt[k] ?? "0")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function fmt(s: string): string {
  return new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 }).format(Number(s)) + " ₪";
}
function sum(a: string, b: string): string {
  return String(Number(a) + Number(b));
}
function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11" />
      <path d="M7.5 11.5 12 16l4.5-4.5" />
      <path d="M5 19.5h14" />
    </svg>
  );
}

function DownloadSpinner() {
  return (
    <svg className="cmp-pdf-spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function shekelFromBreakdown(taxable: string, cash: string): string {
  // שווי שימוש = בסיס מס פחות מזומן
  return fmt(String(Number(taxable) - Number(cash)));
}