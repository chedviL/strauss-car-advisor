// src/features/advisor/ComparisonView.tsx
"use client";
// תצוגת השוואה: כרטיס לצד השיחה. סכומים מפלט המנוע בלבד.
// הפרש נטו עם סימון שאינו צבע-בלבד (חץ + מילה). "חלופה ממתינה" כשחסר נתון.

import { useTransition } from "react";
import { resetDemo } from "../../app/actions.js";
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
  const baseNet = Number(cmp.result.baseline.netDisplay);
  const altNet = Number(cmp.result.alternative.netDisplay);
  const delta = cmp.result.netDeltaDisplay;
  const gain = delta >= 0;

  const baseline = state.scenarios.find((s) => s.role === "baseline")!;
  const alternative = state.scenarios.find((s) => s.role === "alternative")!;

  // תוצאה מיושנת: גרסת-העובדות בהשוואה שונה מהנוכחית.
  const stale = cmp.factsRevision !== state.case.factsRevision;
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
        <button className="btn btn-ghost" disabled={pending} onClick={() => startTransition(() => resetDemo())} style={{ fontSize: "var(--font-sm)" }}>
          התחל מחדש
        </button>
      </div>

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
function shekelFromBreakdown(taxable: string, cash: string): string {
  // שווי שימוש = בסיס מס פחות מזומן
  return fmt(String(Number(taxable) - Number(cash)));
}