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

  return (
    <aside aria-label="הפרטים שלי" style={{
      background: "var(--color-surface)", border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-lg)", padding: "var(--space-3)",
      display: "flex", flexDirection: "column", gap: "var(--space-3)",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h2 style={{ fontSize: "var(--font-lg)", margin: 0 }}>הפרטים שלי</h2>
        <SaveIndicator state={saveState} />
      </div>
      <p style={{ color: "var(--color-muted)", fontSize: "0.8rem", margin: 0 }}>
        שדה ריק נשאר לא ידוע. אפס מוזן במפורש נחשב אפס. <span style={{ color: "var(--color-danger, #b00)" }}>*</span> נחוץ לחישוב נטו.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2) var(--space-3)" }}>
        <label style={fieldStyle}>
          <span style={labelStyle}>קבוצת זכאות <span style={{ color: "var(--color-danger, #b00)" }}>*</span></span>
          <select
            value={values.reportedGroup ?? ""}
            onChange={(e) => onGroupChange(e.target.value)}
            style={inputStyle}
          >
            <option value="">— לא ידוע —</option>
            <option value="א">א</option>
            <option value="ב">ב</option>
            <option value="ג">ג</option>
            <option value="ד">ד</option>
          </select>
        </label>

        {NUMBER_FIELDS.map((f) => (
          <label key={f.key} style={fieldStyle}>
            <span style={labelStyle}>
              {f.label}{f.required ? <span style={{ color: "var(--color-danger, #b00)" }}> *</span> : null}
            </span>
            <span style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <input
                type="number"
                inputMode="decimal"
                step={f.step ?? "1"}
                defaultValue={toDisplay(f.key, values[f.key] as number | null)}
                onBlur={(e) => onNumberBlur(f.key, e.target.value)}
                placeholder="לא ידוע"
                style={inputStyle}
                aria-label={f.label}
              />
              {f.suffix ? <span style={{ position: "absolute", insetInlineEnd: 8, color: "var(--color-muted)", fontSize: "0.8rem" }}>{f.suffix}</span> : null}
            </span>
            {f.hint ? <span style={hintStyle}>{f.hint}</span> : null}
          </label>
        ))}
      </div>

      {saveState === "conflict" && (
        <div role="alert" style={{ color: "var(--color-danger, #b00)", fontSize: "0.8rem" }}>
          הנתונים השתנו בינתיים ממקור אחר. רענן/י את העמוד ונסה/י שוב.
        </div>
      )}
    </aside>
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
  width: "100%", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
  padding: "var(--space-2)", font: "inherit", outline: "none", background: "var(--color-bg, #fff)",
};