// src/features/advisor/ComparisonView.tsx
"use client";
// תצוגת השוואה: כרטיס לצד השיחה. סכומים מפלט המנוע בלבד.
// הפרש נטו עם סימון שאינו צבע-בלבד (חץ + מילה). "חלופה ממתינה" כשחסר נתון.

import { useTransition } from "react";
import { resetDemo } from "../../app/actions.js";
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
}: {
  state: CaseState;
  employee: SampleEmployee | null;
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

  const baseTitle = baseline.route === "waiver" ? "ויתור על רכב" : (baseline.vehicleCode ?? "המצב הנוכחי");
  const altTitle = alternative.route === "waiver" ? "ויתור על רכב" : (alternative.vehicleCode ?? "החלופה");

  return (
    <section className="card" style={{ padding: "var(--space-4)", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-2)" }}>
        <h2 style={{ fontSize: "var(--font-lg)" }}>השוואת נטו חודשי</h2>
        <button className="btn btn-ghost" disabled={pending} onClick={() => startTransition(() => resetDemo())}>
          התחל מחדש
        </button>
      </div>

      {/* שינוי הנטו במרכז - האלמנט הבולט */}
      <div
        role="status"
        style={{
          textAlign: "center", marginTop: "var(--space-3)",
          background: gain ? "var(--color-gain-soft)" : "var(--color-loss-soft)",
          borderRadius: "var(--radius-md)", padding: "var(--space-4)",
        }}
      >
        <div style={{ color: "var(--color-muted)", fontSize: "var(--font-sm)" }}>
          {gain ? "הנטו החודשי צפוי לגדול" : "הנטו החודשי צפוי לקטון"}
        </div>
        <div style={{ fontSize: "var(--font-2xl)", fontWeight: 800, color: gain ? "var(--color-gain)" : "var(--color-loss)", lineHeight: 1.1, marginTop: "var(--space-1)", unicodeBidi: "plaintext" }}>
          <span aria-hidden="true">{gain ? "▲ " : "▼ "}</span>{shekel(Math.abs(delta))}
        </div>
      </div>

      {/* שני עמודים: היום מול החלופה */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
        <ScenarioCol title={`היום · ${baseTitle}`} subtitle={shekel(baseNet)} r={cmp.result.baseline} scen={baseline} />
        <ScenarioCol title={`חלופה · ${altTitle}`} subtitle={shekel(altNet)} r={cmp.result.alternative} scen={alternative} highlight />
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", fontSize: "var(--font-sm)", padding: "3px 0" }}>
      <span style={{ color: "var(--color-muted)" }}>{label}</span>
      <span style={{ unicodeBidi: "plaintext", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

function ScenarioCol({
  title,
  subtitle,
  r,
  scen,
  highlight,
}: {
  title: string;
  subtitle: string;
  r: ScenarioResult & { netDisplay: string };
  scen: { maintenanceAllowance: number; participation: number | null };
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        border: highlight ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-3)",
        background: highlight ? "var(--color-accent-soft)" : "var(--color-surface-2)",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: "var(--font-sm)", color: "var(--color-muted)" }}>{title}</div>
      <div style={{ fontWeight: 800, fontSize: "var(--font-lg)", margin: "2px 0 var(--space-2)", unicodeBidi: "plaintext" }}>{subtitle}</div>
      <Row label="שווי שימוש (זקיפה)" value={shekelFromBreakdown(r.breakdown.taxableIncome, r.breakdown.cashSalary)} />
      <Row label="שכר מזומן" value={fmt(r.breakdown.cashSalary)} />
      <Row label="מס הכנסה" value={fmt(r.breakdown.incomeTax)} />
      <Row label="ביטוח לאומי + בריאות" value={fmt(sum(r.breakdown.nationalInsurance, r.breakdown.health))} />
      <Row label="הפרשות עובד" value={fmt(sum(r.breakdown.pensionEmployee, r.breakdown.trainingEmployee))} />
      <Row label="השתתפות" value={fmt(r.breakdown.participation)} />
      {Number(r.breakdown.familyGap) > 0 && (
        <Row label="פער מסלול משפחתי" value={fmt(r.breakdown.familyGap)} />
      )}
      {scen.maintenanceAllowance > 0 && (
        <Row label="אחזקת רכב" value={fmt(String(scen.maintenanceAllowance))} />
      )}
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