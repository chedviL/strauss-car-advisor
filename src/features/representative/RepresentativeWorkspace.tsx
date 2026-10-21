// src/features/representative/RepresentativeWorkspace.tsx
"use client";
// מסך העבודה של הנציג: רשימת פניות + פרטי פנייה + טופס מענה מובנה.
// אותו מסך ואותם שירותים בגישה רגילה ובהתנסות; ההרשאה נאכפת בשרת (Server Actions + SQL),
// והלקוח אינו שולח בעלים/תפקיד. מוצג ההקשר המינימלי הנחוץ למענה בלבד: ללא שכר, נטו, תלוש
// או היסטוריית שיחה. מחשב: רשימה ופרטים זה לצד זה. נייד: רשימה ואז פרטים עם חזרה.

import "./representative.css";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { answerRepInquiry, attachMyInquiry, detachMyInquiry } from "../../app/actions.js";
import type { RepInquiryView } from "../../server/auth/staff.js";
import type { AttachableInquiry } from "../../server/auth/demo-rep.js";
import {
  TYPE_LABEL, ROUTE_LABEL, ROLE_LABEL,
  formatDate, formatIsoDay, formatMoney, summarize, vehicleLabel,
  parseValueInput, describeValueInput, describeAnswerResult, type ResultMessage,
} from "./rep-format.js";

type Filter = "open" | "answered" | "all";
interface Draft { value: string; note: string; effectiveFrom: string }

const SAVED_STATUSES = new Set(["applied", "recorded_not_applied", "stale_context", "future_effective"]);

function draftFromSaved(q: RepInquiryView): Draft {
  return {
    value: q.inquiry.answerValue !== null ? String(q.inquiry.answerValue) : "",
    note: q.inquiry.answerNote ?? "",
    effectiveFrom: q.inquiry.effectiveFrom ?? "",
  };
}

export function RepresentativeWorkspace({
  mode, initialInquiries, initialAttachable, vehicleNames,
}: {
  mode: "staff" | "demo";
  initialInquiries: RepInquiryView[];
  initialAttachable: AttachableInquiry[];
  vehicleNames: Record<string, string>;
}) {
  const [inquiries, setInquiries] = useState(initialInquiries);
  const [attachable, setAttachable] = useState(initialAttachable);
  const [filter, setFilter] = useState<Filter>(initialInquiries.some((q) => q.inquiry.status === "open") ? "open" : "all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "detail">("list");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [results, setResults] = useState<Record<string, ResultMessage>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [attachMsg, setAttachMsg] = useState<ResultMessage | null>(null);
  const [attachBusy, setAttachBusy] = useState<string | null>(null);

  // מניעת שליחה כפולה: state אסינכרוני, ולכן ref סינכרוני בנוסף ל-disabled.
  const submittingRef = useRef(false);
  const focusTarget = useRef<"detail" | "list" | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const counts = useMemo(() => ({
    open: inquiries.filter((q) => q.inquiry.status === "open").length,
    answered: inquiries.filter((q) => q.inquiry.status === "answered").length,
    all: inquiries.length,
  }), [inquiries]);

  const visible = useMemo(
    () => inquiries.filter((q) => filter === "all" || q.inquiry.status === filter),
    [inquiries, filter],
  );
  const selected = inquiries.find((q) => q.inquiry.id === selectedId) ?? null;

  // ניהול מיקוד: אחרי בחירה - לכותרת הפרטים; אחרי חזרה - לפריט ברשימה.
  useEffect(() => {
    if (focusTarget.current === "detail") headingRef.current?.focus();
    if (focusTarget.current === "list" && selectedId) {
      listRef.current?.querySelector<HTMLButtonElement>(`button[data-id="${selectedId}"]`)?.focus();
    }
    focusTarget.current = null;
  }, [selectedId, view]);

  function select(id: string) {
    focusTarget.current = "detail";
    setSelectedId(id);
    setView("detail");
  }
  function backToList() {
    focusTarget.current = "list";
    setView("list");
  }

  function onListKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button.rep-item"));
    const i = items.findIndex((b) => b === document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === "ArrowDown" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
    items[next]?.focus();
  }

  function draftFor(q: RepInquiryView): Draft {
    return drafts[q.inquiry.id] ?? draftFromSaved(q);
  }
  function setField(q: RepInquiryView, field: keyof Draft, v: string) {
    const id = q.inquiry.id;
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? draftFromSaved(q)), [field]: v } }));
  }
  function setResult(id: string, r: ResultMessage | null) {
    setResults((m) => {
      const next = { ...m };
      if (r) next[id] = r; else delete next[id];
      return next;
    });
  }

  async function submit(e: FormEvent, q: RepInquiryView) {
    e.preventDefault();
    if (submittingRef.current) return;
    const id = q.inquiry.id;
    const isParticipation = q.inquiry.type === "employee_participation";
    const draft = draftFor(q);

    let value: number | null = null;
    if (isParticipation) {
      const p = parseValueInput(draft.value);
      if (p.kind === "invalid") { setResult(id, { tone: "err", title: p.message }); return; }
      value = p.kind === "value" ? p.value : null; // 0 הוא ערך מפורש; ריק = חסר
    }
    const note = draft.note.trim() === "" ? null : draft.note.trim();
    if (isParticipation && value === null && note === null) {
      setResult(id, { tone: "err", title: "יש להזין ערך השתתפות (גם 0 הוא ערך תקין) או הערה." });
      return;
    }
    if (!isParticipation && note === null) {
      setResult(id, { tone: "err", title: "יש לכתוב את תשובת ההבהרה." });
      return;
    }

    submittingRef.current = true;
    setBusyId(id);
    setResult(id, null);
    try {
      const res = await answerRepInquiry(id, {
        value,
        note,
        effectiveFrom: draft.effectiveFrom.trim() === "" ? null : draft.effectiveFrom,
      });
      setResult(id, describeAnswerResult(res));
      if (res.inquiries) setInquiries(res.inquiries);
      // נשמר: הטופס יציג את הערכים השמורים. כשל שניתן לתיקון: הטיוטה נשמרת.
      if (SAVED_STATUSES.has(res.status)) {
        setDrafts((d) => { const n = { ...d }; delete n[id]; return n; });
      }
    } catch {
      setResult(id, { tone: "err", title: "לא הצלחנו להתחבר לשרת.", detail: "הטופס נשמר; אפשר לנסות שוב." });
    } finally {
      submittingRef.current = false;
      setBusyId(null);
    }
  }

  async function runAttach(kind: "attach" | "detach", inquiryId: string) {
    if (attachBusy) return;
    setAttachBusy(inquiryId);
    setAttachMsg(null);
    try {
      const res = kind === "attach" ? await attachMyInquiry(inquiryId) : await detachMyInquiry(inquiryId);
      if (res.status === "ok") {
        setInquiries(res.inquiries);
        setAttachable(res.attachable);
        if (kind === "detach") { setSelectedId(null); setView("list"); }
      } else if (res.status === "not_found") {
        setAttachMsg({ tone: "err", title: kind === "attach" ? "לא ניתן לצרף פנייה זו." : "לא ניתן להסיר פנייה זו." });
      } else {
        setAttachMsg({ tone: "err", title: "אין הרשאה. ייתכן שהגישה להתנסות הופסקה; רעננו את הדף." });
      }
    } catch {
      setAttachMsg({ tone: "err", title: "לא הצלחנו להתחבר לשרת. נסו שוב." });
    } finally {
      setAttachBusy(null);
    }
  }

  const filters: Array<{ key: Filter; label: string; n: number }> = [
    { key: "open", label: "פתוחות", n: counts.open },
    { key: "answered", label: "נענו", n: counts.answered },
    { key: "all", label: "הכול", n: counts.all },
  ];

  return (
    <div className="rep-layout" data-view={view}>
      {/* ---------- רשימה ---------- */}
      <section className="rep-list-pane" aria-labelledby="rep-list-title">
        <h2 id="rep-list-title" style={srOnly}>רשימת פניות</h2>
        <div className="rep-filter" role="group" aria-label="סינון פניות לפי מצב">
          {filters.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label} ({f.n})
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="rep-empty" role="status">
            {filter === "open" ? "אין פניות פתוחות כרגע." : filter === "answered" ? "עדיין לא נענתה אף פנייה." : "אין פניות להצגה."}
          </p>
        ) : (
          <ul className="rep-list" ref={listRef} onKeyDown={onListKeyDown}>
            {visible.map((q) => (
              <li key={q.inquiry.id}>
                <button
                  type="button" className="rep-item" data-id={q.inquiry.id} data-status={q.inquiry.status}
                  aria-current={selectedId === q.inquiry.id ? "true" : undefined}
                  onClick={() => select(q.inquiry.id)}
                >
                  <span className="rep-item-title">{TYPE_LABEL[q.inquiry.type]}</span>
                  <span className="rep-item-meta">
                    <span className="rep-badge" data-kind={q.inquiry.status === "answered" ? "answered" : "open"}>
                      {q.inquiry.status === "answered" ? "נענתה" : "פתוחה"}
                    </span>
                    <span>{formatDate(q.inquiry.createdAt)}</span>
                    {q.origin === "seeded" && <span className="rep-badge" data-kind="sample">פנייה לדוגמה</span>}
                    {q.origin === "owned" && <span className="rep-badge" data-kind="mine">הפנייה שלי</span>}
                  </span>
                  <span className="rep-item-summary">
                    {summarize({ type: q.inquiry.type, scenarioRole: q.scenarioRole, route: q.route, vehicleCode: q.vehicleCode }, vehicleNames)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {mode === "demo" && (
          <details className="rep-attach">
            <summary>הפניות שלי מהשיחה ({attachable.length})</summary>
            {attachable.length === 0 ? (
              <p className="rep-hint" style={{ marginTop: "var(--space-2)" }}>
                אין כרגע פניות פתוחות שפתחת. בשיחה עם היועץ אפשר לבקש פנייה לנציג בנושא השתתפות ברכב, ואז לחזור לכאן ולצרף אותה.
              </p>
            ) : (
              <ul>
                {attachable.map((a) => (
                  <li key={a.inquiryId}>
                    <span>
                      {TYPE_LABEL[a.type]} · {formatDate(a.createdAt)}
                      <br />
                      <span className="rep-hint">{summarize({ type: a.type, scenarioRole: a.scenarioRole, route: a.route, vehicleCode: a.vehicleCode }, vehicleNames)}</span>
                    </span>
                    <button type="button" className="btn" disabled={attachBusy !== null} onClick={() => runAttach("attach", a.inquiryId)}>
                      {attachBusy === a.inquiryId ? "מצרף…" : "צרף להדגמה"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div aria-live="polite">
              {attachMsg && <p className="rep-result" data-tone={attachMsg.tone} role={attachMsg.tone === "err" ? "alert" : "status"}><strong>{attachMsg.title}</strong></p>}
            </div>
          </details>
        )}
      </section>

      {/* ---------- פרטי פנייה ---------- */}
      <section className="rep-detail-pane" aria-label="פרטי הפנייה">
        {!selected ? (
          <div className="rep-card"><p className="rep-placeholder" style={{ margin: 0 }}>בחרו פנייה מהרשימה כדי לראות את ההקשר ולענות.</p></div>
        ) : (
          <DetailCard
            key={selected.inquiry.id}
            q={selected}
            mode={mode}
            vehicleNames={vehicleNames}
            draft={draftFor(selected)}
            busy={busyId === selected.inquiry.id}
            result={results[selected.inquiry.id] ?? null}
            headingRef={headingRef}
            onBack={backToList}
            onField={(f, v) => setField(selected, f, v)}
            onSubmit={(e) => submit(e, selected)}
            onDetach={() => runAttach("detach", selected.inquiry.id)}
            detachBusy={attachBusy === selected.inquiry.id}
          />
        )}
      </section>
    </div>
  );
}

const srOnly: React.CSSProperties = {
  position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0,
};

function DetailCard({
  q, mode, vehicleNames, draft, busy, result, headingRef, onBack, onField, onSubmit, onDetach, detachBusy,
}: {
  q: RepInquiryView;
  mode: "staff" | "demo";
  vehicleNames: Record<string, string>;
  draft: Draft;
  busy: boolean;
  result: ResultMessage | null;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
  onField: (f: keyof Draft, v: string) => void;
  onSubmit: (e: FormEvent) => void;
  onDetach: () => void;
  detachBusy: boolean;
}) {
  const isParticipation = q.inquiry.type === "employee_participation";
  const answered = q.inquiry.status === "answered";
  const parsed = parseValueInput(draft.value);
  const vehicle = vehicleLabel(q.vehicleCode, vehicleNames);

  return (
    <article className="rep-card rep-detail" aria-labelledby="rep-detail-title">
      <button type="button" className="btn btn-ghost rep-back" onClick={onBack}>← חזרה לרשימה</button>
      <h2 id="rep-detail-title" ref={headingRef} tabIndex={-1}>{TYPE_LABEL[q.inquiry.type]}</h2>

      {/* הקשר מינימלי בלבד */}
      <dl className="rep-context">
        <dt>נפתחה</dt><dd>{formatDate(q.inquiry.createdAt)}</dd>
        {q.scenarioRole && (<><dt>הנושא</dt><dd>{ROLE_LABEL[q.scenarioRole]}</dd></>)}
        {q.route && (<><dt>מסלול</dt><dd>{ROUTE_LABEL[q.route] ?? q.route}</dd></>)}
        {vehicle && (<><dt>רכב</dt><dd>{vehicle}</dd></>)}
        {q.reportedGroup && (<><dt>קבוצת זכאות</dt><dd>{q.reportedGroup}</dd></>)}
        {isParticipation && (<><dt>השתתפות נוכחית</dt><dd>{formatMoney(q.currentParticipation)}</dd></>)}
      </dl>

      {mode === "demo" && q.origin === "owned" && (
        <p className="rep-origin-note">
          זו פנייה שפתחת בעצמך ושצירפת להדגמה. מענה ישלח התראה למייל המאומת שלך.{" "}
          <button type="button" className="btn btn-ghost" disabled={detachBusy} onClick={onDetach}>
            {detachBusy ? "מסיר…" : "הסרה מההדגמה"}
          </button>
        </p>
      )}
      {mode === "demo" && q.origin === "seeded" && (
        <p className="rep-origin-note">פנייה פיקטיבית לדוגמה. מענה לפנייה זו אינו שולח מייל.</p>
      )}

      {/* התשובה שנשמרה */}
      {answered && (
        <div className="rep-saved">
          <h3>התשובה שנשמרה</h3>
          <dl>
            {isParticipation && (<><dt>השתתפות</dt><dd>{q.inquiry.answerValue !== null ? formatMoney(q.inquiry.answerValue) : "ללא ערך (הערה בלבד)"}</dd></>)}
            {q.inquiry.answerNote && (<><dt>הערה</dt><dd>{q.inquiry.answerNote}</dd></>)}
            {q.inquiry.effectiveFrom && (<><dt>בתוקף מתאריך</dt><dd>{formatIsoDay(q.inquiry.effectiveFrom)}</dd></>)}
            {q.inquiry.answeredAt && (<><dt>נענתה</dt><dd>{formatDate(q.inquiry.answeredAt)}</dd></>)}
          </dl>
        </div>
      )}

      {/* טופס מענה */}
      <form className="rep-form" onSubmit={onSubmit} aria-busy={busy} noValidate>
        <fieldset disabled={busy}>
          <legend style={srOnly}>{answered ? "עדכון תשובה" : "מענה לפנייה"}</legend>
          {isParticipation && (
            <div className="rep-field">
              <label htmlFor="rep-value">השתתפות חודשית (₪)</label>
              <input
                id="rep-value" type="number" inputMode="decimal" min="0" step="1"
                value={draft.value} onChange={(e) => onField("value", e.target.value)}
                aria-describedby="rep-value-hint" placeholder="לדוגמה 300"
              />
              <p id="rep-value-hint" className="rep-hint" data-kind={parsed.kind === "value" && parsed.value === 0 ? "zero" : undefined}>
                {describeValueInput(parsed)}
              </p>
            </div>
          )}
          <div className="rep-field">
            <label htmlFor="rep-note">{isParticipation ? "הערת נציג (לא חובה)" : "תשובת ההבהרה"}</label>
            <textarea
              id="rep-note" value={draft.note} maxLength={500} rows={3}
              onChange={(e) => onField("note", e.target.value)}
              placeholder={isParticipation ? "הקשר קצר לתשובה" : "מה התשובה לשאלת הזכאות"}
            />
          </div>
          <div className="rep-field">
            <label htmlFor="rep-effective">בתוקף מתאריך (לא חובה)</label>
            <input id="rep-effective" type="date" value={draft.effectiveFrom} onChange={(e) => onField("effectiveFrom", e.target.value)} aria-describedby="rep-effective-hint" />
            <p id="rep-effective-hint" className="rep-hint">ריק = בתוקף מיידי. תאריך עתידי נשמר ואינו מוחל עד שיגיע.</p>
          </div>
        </fieldset>

        <div className="rep-actions">
          <button type="submit" className="btn btn-graphite" disabled={busy}>
            {busy ? (<><span className="rep-spinner" aria-hidden="true" />שומר…</>) : answered ? "עדכון תשובה" : "שליחת תשובה"}
          </button>
        </div>

        <div aria-live="polite">
          {result && (
            <div className="rep-result" data-tone={result.tone} role={result.tone === "err" ? "alert" : "status"}>
              <strong>{result.title}</strong>
              {result.detail && <span>{result.detail}</span>}
            </div>
          )}
        </div>
      </form>
    </article>
  );
}

