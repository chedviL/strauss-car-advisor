// src/features/advisor/ComparisonView.tsx
"use client";
// תצוגת השוואה: כרטיס לצד השיחה. סכומים מפלט המנוע בלבד.
// הפרש נטו עם סימון שאינו צבע-בלבד (חץ + מילה). "חלופה ממתינה" כשחסר נתון.

import { useTransition } from "react";
import { resetDemo } from "../../app/actions.js";
import type { CaseState } from "../../domain/contracts/case.js";
import type { NetBreakdown, ScenarioResult } from "../../domain/contracts/types.js";
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

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: "var(--space-4)" }}>
      {/* צד השיחה (placeholder לחיבור הסוכן בשלב הבא) */}
      <aside
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-3)",
          boxShadow: "var(--shadow)",
          alignSelf: "start",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: "var(--font-lg)" }}>
          {employee ? employee.name : "התיק שלך"}
        </h2>
        {employee && (
          <p style={{ color: "var(--color-muted)" }}>{employee.question}</p>
        )}
        <div style={{ fontSize: "0.85rem", color: "var(--color-muted)", marginTop: "var(--space-3)" }}>
          השיחה החופשית תתחבר בשלב הבא לאותם שירותים. כעת מוצג חישוב מלא ושמור.
        </div>
        <button
          className="btn"
          style={{ marginTop: "var(--space-3)" }}
          disabled={pending}
          onClick={() => startTransition(() => resetDemo())}
        >
          התחל מחדש
        </button>
      </aside>

      {/* כרטיס ההשוואה */}
      <section
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-4)",
          boxShadow: "var(--shadow)",
        }}
      >
        <div
          role="status"
          style={{
            fontSize: "var(--font-lg)",
            fontWeight: 700,
            color: gain ? "var(--color-gain)" : "var(--color-loss)",
          }}
        >
          <span aria-hidden="true">{gain ? "▲" : "▼"}</span>{" "}
          {gain ? "תרוויח" : "תפסיד"} {shekel(Math.abs(delta))} בנטo החודשי
        </div>
        <p style={{ color: "var(--color-muted)", marginTop: "var(--space-1)" }}>
          מהיום ({shekel(baseNet)}) לחלופה ({shekel(altNet)}). ההפרש משקף שינוי בשווי
          השימוש, בניכויי המס והביטוח ובהשתתפות - לא העברת מזומן.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
          <ScenarioCol title={`היום · ${baseline.route === "waiver" ? "ויתור" : baseline.vehicleCode ?? ""}`} r={cmp.result.baseline} scen={baseline} />
          <ScenarioCol title={`חלופה · ${alternative.route === "waiver" ? "ויתור" : alternative.vehicleCode ?? ""}`} r={cmp.result.alternative} scen={alternative} highlight />
        </div>

        <details style={{ marginTop: "var(--space-3)" }}>
          <summary style={{ cursor: "pointer", color: "var(--color-primary)" }}>פירוט מלא</summary>
          <BreakdownTable base={cmp.result.baseline.breakdown} alt={cmp.result.alternative.breakdown} />
        </details>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem", padding: "2px 0" }}>
      <span style={{ color: "var(--color-muted)" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function ScenarioCol({
  title,
  r,
  scen,
  highlight,
}: {
  title: string;
  r: ScenarioResult & { netDisplay: string };
  scen: { maintenanceAllowance: number; participation: number | null };
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        padding: "var(--space-3)",
        background: highlight ? "rgba(11,95,255,0.04)" : "transparent",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "var(--space-2)" }}>{title}</div>
      <Row label="שווי שימוש" value={shekelFromBreakdown(r.breakdown.taxableIncome, r.breakdown.cashSalary)} />
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
      <div style={{ borderTop: "1px solid var(--color-border)", marginTop: "var(--space-2)", paddingTop: "var(--space-2)", fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
        <span>נטו משוער</span>
        <span>{fmt(r.netDisplay)}</span>
      </div>
    </div>
  );
}

function BreakdownTable({ base, alt }: { base: NetBreakdown; alt: NetBreakdown }) {
  const labels: Record<string, string> = {
    cashSalary: "שכר מזומן", taxableIncome: "בסיס מס", incomeTax: "מס הכנסה",
    nationalInsurance: "ביטוח לאומי", health: "בריאות", pensionEmployee: "פנסיה עובד",
    trainingEmployee: "קרן השתלמות עובד", participation: "השתתפות", familyGap: "פער משפחתי",
    electricGrossUp: "גילום החזר חשמל", pensionCredit: "זיכוי פנסיה", creditPointsCredit: "זיכוי נק' זיכוי",
  };
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