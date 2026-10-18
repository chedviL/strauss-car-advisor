// src/features/advisor/PayslipUpload.tsx
"use client";
// העלאת תלוש -> אחסון פרטי -> חילוץ (באישור, בתשלום) -> אישור/עריכה -> החלה על התיק.
// שלבים: idle -> uploading -> uploaded(estimate) -> extracting -> review -> applied.
// שום דבר לא מוחל על התיק בלי אישור מפורש. נתון חסר (null) אינו אפס.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateMyFacts } from "../../app/actions.js";

type Field = { value: number | null; confidence: "high" | "low" };
type Extraction = {
  baseSalary: Field; commission: Field; bonus: Field;
  pensionRate: Field; trainingRate: Field; creditPoints: Field; notes: string;
};

type Phase = "idle" | "uploading" | "uploaded" | "extracting" | "review" | "applying" | "applied" | "error";

const RATE_KEYS = new Set(["pensionRate", "trainingRate"]);
const LABELS: Record<string, string> = {
  baseSalary: "שכר בסיס (ברוטו)", commission: "עמלות", bonus: "בונוס",
  pensionRate: "פנסיה %", trainingRate: "קרן השתלמות %", creditPoints: "נקודות זיכוי",
};
const toDisp = (k: string, v: number | null) => v === null ? "" : (RATE_KEYS.has(k) ? String(Math.round(v * 1000) / 10) : String(v));
const fromDisp = (k: string, s: string): number | null => {
  const t = s.trim(); if (t === "") return null; const n = Number(t); if (!Number.isFinite(n)) return null;
  return RATE_KEYS.has(k) ? Math.round((n / 100) * 10000) / 10000 : n;
};

export function PayslipUpload({ onApplied }: { onApplied?: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState<string>("");
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Extraction | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function upload(file: File) {
    setPhase("uploading"); setMsg(file.name);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/payslip?action=upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setPhase("error"); setMsg(data.error ?? "העלאה נכשלה."); return; }
      setUploadId(data.uploadId); setPhase("uploaded");
      setMsg(`הקובץ נקלט (${data.originalName ?? "תלוש"}). חילוץ הנתונים משתמש במודל — לאישורך.`);
    } catch { setPhase("error"); setMsg("שגיאת רשת בהעלאה."); }
  }

  async function extract() {
    if (!uploadId) return;
    setPhase("extracting"); setMsg("מחלץ נתונים מהתלוש…");
    try {
      const res = await fetch("/api/payslip?action=extract", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadId }),
      });
      const data = await res.json();
      if (!res.ok) { setPhase("error"); setMsg(data.error ?? "החילוץ נכשל."); return; }
      setDraft(data.extraction as Extraction); setPhase("review"); setMsg("");
    } catch { setPhase("error"); setMsg("שגיאת רשת בחילוץ."); }
  }

  async function apply() {
    if (!draft) return;
    setPhase("applying");
    // רק שדות עם ערך (כולל 0 מפורש) מוחלים; null = לא ידוע, לא נשלח (לא דורס).
    const patch: Record<string, number | null> = {};
    (Object.keys(LABELS) as Array<keyof Extraction>).forEach((k) => {
      const f = draft[k] as Field;
      if (f.value !== null) patch[k as string] = f.value;
    });
    const res = await updateMyFacts(patch);
    if (res.status === "ok") {
      setPhase("applied"); setMsg("הנתונים הוחלו על התיק. אפשר לשנות כל פרט ולהמשיך בשיחה.");
      router.refresh(); onApplied?.();
    } else if (res.status === "conflict") {
      setPhase("error"); setMsg("הנתונים השתנו בינתיים; רענן/י ונסה/י שוב.");
    } else {
      setPhase("error"); setMsg("שגיאה בהחלת הנתונים.");
    }
  }

  function reset() { setPhase("idle"); setMsg(""); setUploadId(null); setDraft(null); }

  function pick(files: FileList | null) {
    const f = files?.[0]; if (f) void upload(f);
  }

  const busy = phase === "uploading" || phase === "extracting" || phase === "applying";

  return (
    <>
      <input
        ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp"
        hidden onChange={(e) => pick(e.target.files)}
      />
      <button
        type="button" className="icon-btn" aria-label="העלאת תלוש"
        title="העלאת תלוש (PDF או תמונה)"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files); }}
        style={dragOver ? { borderColor: "var(--color-primary)", background: "var(--color-accent-soft)" } : undefined}
      >
        <PaperclipIcon />
      </button>

      {phase !== "idle" && (
        <div role="dialog" aria-label="העלאת תלוש" style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget && !busy) reset(); }}>
          <div className="card anim-card" style={panelStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
              <h3 style={{ fontSize: "var(--font-lg)" }}>נתוני התלוש</h3>
              {!busy && <button type="button" className="icon-btn" aria-label="סגירה" onClick={reset}><CloseIcon /></button>}
            </div>

            {msg && <p style={{ color: "var(--color-muted)", fontSize: "var(--font-sm)", marginBottom: "var(--space-3)" }}>{msg}</p>}

            {phase === "uploaded" && (
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <button type="button" className="btn btn-primary" onClick={extract}>חלץ נתונים</button>
                <button type="button" className="btn btn-ghost" onClick={reset}>ביטול</button>
              </div>
            )}

            {phase === "review" && draft && (
              <>
                <p style={{ fontSize: "var(--font-sm)", color: "var(--color-muted)", marginBottom: "var(--space-2)" }}>
                  בדקו ותקנו לפני החלה. שדה ריק = לא זוהה (לא יוחל, ולא ידרוס נתון קיים). סימון «?» = ודאות נמוכה.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2) var(--space-3)" }}>
                  {(Object.keys(LABELS) as Array<keyof Extraction>).map((k) => {
                    const f = draft[k] as Field;
                    return (
                      <label key={k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: "var(--font-sm)", fontWeight: 600 }}>
                          {LABELS[k as string]}{f.confidence === "low" ? <span title="ודאות נמוכה" style={{ color: "var(--color-loss)" }}> ?</span> : null}
                        </span>
                        <input
                          type="number" inputMode="decimal" step="0.01"
                          defaultValue={toDisp(k as string, f.value)}
                          placeholder="לא זוהה"
                          onChange={(e) => setDraft((d) => d ? { ...d, [k]: { ...(d[k] as Field), value: fromDisp(k as string, e.target.value) } } : d)}
                          style={{ width: "100%" }}
                        />
                      </label>
                    );
                  })}
                </div>
                {draft.notes && <p style={{ fontSize: "0.72rem", color: "var(--color-muted)", marginTop: "var(--space-2)" }}>{draft.notes}</p>}
                <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
                  <button type="button" className="btn btn-primary" onClick={apply}>החל על התיק</button>
                  <button type="button" className="btn btn-ghost" onClick={reset}>ביטול</button>
                </div>
              </>
            )}

            {phase === "applied" && (
              <button type="button" className="btn" onClick={reset}>סגור</button>
            )}
            {phase === "error" && (
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <button type="button" className="btn" onClick={reset}>סגור</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(34,29,24,0.32)", zIndex: 60,
  display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-4)",
};
const panelStyle: React.CSSProperties = {
  width: "min(520px, 96vw)", maxHeight: "86vh", overflowY: "auto", padding: "var(--space-4)",
};

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
function CloseIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>;
}