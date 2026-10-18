// src/features/advisor/MyDetailsPanel.tsx
"use client";
// "הפרטים שלי": טופס הזנה עצמאית. אותו תיק ואותם שירותים כמו השיחה.
// - שדה ריק = לא ידוע (null). אפס מוזן במפורש הוא אפס אמיתי.
// - רק שדות שנתמכים במערכת. סימון מה נחוץ לחישוב.
// - שמירה אוטומטית בעריכה (onBlur) עם חיווי שקט; אין הפעלת מודל.
// - החישוב מתבצע דרך השיחה/כפתור, לא מעצם עריכת שדה.

import { useState, useTransition } from "react";
import { updateMyFacts } from "../../app/actions.js";

type Facts = {
  occupationCode: string | null;
  reportedGroup: string | null;
  baseSalary: number | null;
  commission: number | null;
  bonus: number | null;
  pensionRate: number | null;
  trainingRate: number | null;
  creditPoints: number | null;
  qualifyingChildren: number | null;
};

type FieldKey = keyof Facts;

const NUMBER_FIELDS: Array<{ key: FieldKey; label: string; hint?: string; required?: boolean; step?: string; suffix?: string }> = [
  { key: "baseSalary", label: "שכר בסיס (ברוטו)", hint: "₪ לחודש", required: true, suffix: "₪" },
  { key: "commission", label: "עמלות", hint: "₪ לחודש; 0 = אין", suffix: "₪" },
  { key: "bonus", label: "בונוס", hint: "₪ לחודש; 0 = אין", suffix: "₪" },
  { key: "pensionRate", label: "שיעור פנסיה", hint: "אחוז, למשל 6", required: true, step: "0.1", suffix: "%" },
  { key: "trainingRate", label: "קרן השתלמות", hint: "אחוז; 0 = אין", step: "0.1", suffix: "%" },
  { key: "creditPoints", label: "נקודות זיכוי", hint: "למשל 2.25", required: true, step: "0.25" },
  { key: "qualifyingChildren", label: "ילדים מזכים", hint: "מספר", step: "1" },
];

// המרה בין ערך המנוע (שבר, למשל 0.06) לאחוז בתצוגה (6).
const RATE_FIELDS = new Set<FieldKey>(["pensionRate", "trainingRate"]);

function toDisplay(key: FieldKey, v: number | null): string {
  if (v === null || v === undefined) return "";
  if (RATE_FIELDS.has(key)) return String(Math.round(v * 1000) / 10); // 0.065 -> 6.5
  return String(v);
}
function fromInput(key: FieldKey, raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null; // ריק = לא ידוע
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (RATE_FIELDS.has(key)) return Math.round((n / 100) * 10000) / 10000; // 6.5 -> 0.065
  return n;
}

type SaveState = "idle" | "saving" | "saved" | "conflict";

export function MyDetailsPanel({ facts }: { facts: Facts }) {
  const [values, setValues] = useState<Facts>(facts);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [, startTransition] = useTransition();

  function persist(patch: Partial<Facts>) {
    setSaveState("saving");
    startTransition(async () => {
      const res = await updateMyFacts(patch);
      setSaveState(res.status === "ok" ? "saved" : res.status === "conflict" ? "conflict" : "idle");
      if (res.status === "ok") setTimeout(() => setSaveState("idle"), 1500);
    });
  }

  function onNumberBlur(key: FieldKey, raw: string) {
    const next = fromInput(key, raw);
    if (next === values[key]) return; // לא השתנה - לא שומרים
    setValues((v) => ({ ...v, [key]: next }));
    persist({ [key]: next } as Partial<Facts>);
  }

  function onGroupChange(group: string) {
    const next = group === "" ? null : group;
    setValues((v) => ({ ...v, reportedGroup: next }));
    persist({ reportedGroup: next });
  }

  function renderField(f: { key: FieldKey; label: string; hint?: string; required?: boolean; step?: string; suffix?: string }) {
    return (
      <label key={f.key} style={fieldStyle}>
        <span style={labelStyle}>
          {f.label}{f.required ? <span style={{ color: "var(--color-danger)" }}> *</span> : null}
        </span>
        <span style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <input
            type="number" inputMode="decimal" step={f.step ?? "1"}
            defaultValue={toDisplay(f.key, values[f.key] as number | null)}
            onBlur={(e) => onNumberBlur(f.key, e.target.value)}
            placeholder="לא ידוע" style={{ ...inputStyle, paddingInlineEnd: f.suffix ? 28 : undefined }} aria-label={f.label}
          />
          {f.suffix ? <span style={{ position: "absolute", insetInlineEnd: 10, color: "var(--color-muted)", fontSize: "var(--font-sm)" }}>{f.suffix}</span> : null}
        </span>
        {f.hint ? <span style={hintStyle}>{f.hint}</span> : null}
      </label>
    );
  }

  return (
    <aside aria-label="הפרטים שלי" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
        <p style={{ color: "var(--color-muted)", fontSize: "var(--font-sm)", margin: 0 }}>
          שדה ריק נשאר לא ידוע. אפס מפורש נחשב אפס. <span style={{ color: "var(--color-danger)" }}>*</span> נחוץ לחישוב.
        </p>
        <SaveIndicator state={saveState} />
      </div>

      <Section title="זכאות">
        <label style={fieldStyle}>
          <span style={labelStyle}>קבוצת זכאות <span style={{ color: "var(--color-danger)" }}>*</span></span>
          <select value={values.reportedGroup ?? ""} onChange={(e) => onGroupChange(e.target.value)} style={inputStyle}>
            <option value="">— לא ידוע —</option>
            <option value="א">א</option>
            <option value="ב">ב</option>
            <option value="ג">ג</option>
            <option value="ד">ד</option>
          </select>
        </label>
      </Section>

      <Section title="שכר והכנסה">
        {NUMBER_FIELDS.filter((f) => ["baseSalary", "commission", "bonus"].includes(f.key)).map(renderField)}
      </Section>

      <Section title="הפרשות, זיכויים ומשפחה">
        {NUMBER_FIELDS.filter((f) => ["pensionRate", "trainingRate", "creditPoints", "qualifyingChildren"].includes(f.key)).map(renderField)}
      </Section>

      {saveState === "conflict" && (
        <div role="alert" style={{ color: "var(--color-danger, #b00)", fontSize: "0.8rem" }}>
          הנתונים השתנו בינתיים ממקור אחר. רענן/י את העמוד ונסה/י שוב.
        </div>
      )}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: "var(--font-sm)", fontWeight: 700, color: "var(--color-muted)", marginBottom: "var(--space-2)", letterSpacing: "0.02em" }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2) var(--space-3)" }}>
        {children}
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving") return <span style={{ color: "var(--color-muted)", fontSize: "0.78rem" }} aria-live="polite">שומר…</span>;
  if (state === "saved") return <span style={{ color: "var(--color-muted)", fontSize: "0.78rem" }} aria-live="polite">נשמר</span>;
  return <span style={{ fontSize: "0.78rem", color: "transparent" }}>·</span>;
}

const fieldStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 2 };
const labelStyle: React.CSSProperties = { fontSize: "0.82rem", fontWeight: 600 };
const hintStyle: React.CSSProperties = { fontSize: "0.72rem", color: "var(--color-muted)" };
const inputStyle: React.CSSProperties = {
  width: "100%", borderRadius: "var(--radius-sm)", padding: "var(--space-2) var(--space-3)",
  font: "inherit", background: "var(--color-surface)",
};