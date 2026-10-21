// src/features/advisor/vehicle-match/MatchResults.tsx
"use client";
// מסך התוצאות: עד שלושה כרטיסים לפי כיסוי הנתונים + "דורשים בדיקה" בנפרד.
// כל הטקסטים (סיבות/שיקולים/מפרטים) נוצרו במנוע מתוך מבנה הנתונים - אין תלות במודל.

import type { MatchOption, MatchResult } from "../../../domain/vehicle-match/types.js";
import { GROUP_CHOICES, RESULTS } from "./copy.js";
import { ChoiceGroup } from "./ChoiceGroup.js";
import type { GroupChoice } from "./match-state.js";

const MARKETS: Record<string, string> = { IL: "ישראל", IE: "אירלנד", TR: "טורקיה", EU: "אירופה", AU: "אוסטרליה" };

function signedShekel(n: number): string {
  const abs = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 }).format(Math.abs(n));
  return `${n < 0 ? "−" : "+"}${abs} ₪`;
}

export function GroupPrompt({
  hasCase, value, onChange, onSubmit, onAskInChat,
}: {
  hasCase: boolean;
  value: GroupChoice | null;
  onChange: (g: GroupChoice) => void;
  onSubmit: () => void;
  onAskInChat: () => void;
}) {
  return (
    <section className="vm-group-prompt" aria-labelledby="vm-group-title">
      <h3 id="vm-group-title" className="vm-h3">מהי קבוצת הזכאות שלך?</h3>
      <p className="vm-muted">
        כדי להציג רק רכבים שבזכאות שלך צריך לדעת את הקבוצה. אנחנו לא מנחשים אותה לפי התפקיד.
        {hasCase ? " הקבוצה תישמר בפרטים שלך בשיחה הזו." : " נשתמש בה להתאמה בלבד; בשיחה נשאל שוב אם צריך."}
      </p>
      <ChoiceGroup<GroupChoice>
        name="vm-group" labelledBy="vm-group-title" choices={GROUP_CHOICES} value={value} onChange={onChange} compact
      />
      <div className="vm-actions-row">
        <button type="button" className="btn btn-graphite" disabled={value === null} onClick={onSubmit}>הצגת האפשרויות</button>
        <button type="button" className="btn btn-ghost" onClick={onAskInChat}>נברר את זה בשיחה</button>
      </div>
    </section>
  );
}

export function MatchResults({
  result, hasCase, summary, onEdit, onPick,
}: {
  result: MatchResult;
  hasCase: boolean;
  summary: string[];
  onEdit: () => void;
  onPick: (vehicleName: string) => void;
}) {
  void hasCase;
  return (
    <div className="vm-results">
      <div className="vm-summary vm-rise" style={{ ["--s" as string]: "2" }}>
        <ul className="vm-chips" aria-label="תקציר התשובות שלך">
          {summary.map((s) => <li key={s}>{s}</li>)}
        </ul>
        <button type="button" className="btn btn-ghost vm-edit" onClick={onEdit}>{RESULTS.edit}</button>
      </div>

      {result.groupUsed && (
        <p className="vm-muted vm-small vm-rise" style={{ ["--s" as string]: "3" }}>מוצגים רכבים מקבוצת הזכאות שלך ({result.groupUsed}) או נמוכה ממנה, וכן מסלול ברוכי ילדים כשהוא רלוונטי.</p>
      )}
      {result.rankingNote && <p className="vm-rank-note">{result.rankingNote}</p>}

      {result.emptyReason && <p className="vm-empty" role="status">{result.emptyReason}</p>}

      {result.options.length > 0 && (
        <ol className="vm-cards" aria-label="האפשרויות המתאימות">
          {result.options.map((o, i) => (
            <li key={o.vehicleId} className="vm-card-wrap" style={{ ["--i" as string]: String(i) }}>
              <OptionCard option={o} onPick={onPick} ranked={result.rankingBasis !== "none"} />
            </li>
          ))}
        </ol>
      )}

      {result.needsCheck.length > 0 && (
        <section className="vm-check" aria-labelledby="vm-check-title">
          <h3 id="vm-check-title" className="vm-h3">{RESULTS.needsCheck}</h3>
          <p className="vm-muted vm-small">{RESULTS.needsCheckHint}</p>
          <ul className="vm-check-list">
            {result.needsCheck.map((o) => (
              <li key={o.vehicleId} className="vm-check-item">
                <div className="vm-check-head">
                  <strong>{o.name}</strong>
                  <span className="vm-tag">קבוצה {o.group === "משפחתי" ? "משפחתית" : o.group}</span>
                </div>
                {o.checkReason && <p className="vm-small">{o.checkReason}</p>}
                <button type="button" className="btn btn-ghost vm-small-btn" onClick={() => onPick(o.name)}>{RESULTS.compareCta}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.coverageNotes.length > 0 && (
        <ul className="vm-notes">
          {result.coverageNotes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}

function OptionCard({ option: o, onPick, ranked }: { option: MatchOption; onPick: (name: string) => void; ranked: boolean }) {
  const shownConsiderations = o.considerations.slice(0, 2);
  const restConsiderations = o.considerations.slice(2);
  return (
    <article className="vm-card" aria-labelledby={`vm-card-${o.vehicleId}`}>
      <header className="vm-card-head">
        <div>
          <h3 id={`vm-card-${o.vehicleId}`} className="vm-card-title">{o.name}</h3>
          <p className="vm-card-sub">
            <span className="vm-tag">{o.group === "משפחתי" ? "קבוצה משפחתית" : `קבוצת זכאות ${o.group}`}</span>
            <span>{o.propulsionLabel}{o.bodyType ? ` · ${o.bodyType}` : ""}</span>
          </p>
        </div>
        {o.badges.length > 0 && (
          <ul className="vm-badges" aria-label="יתרונות מאומתים">
            {o.badges.map((b) => (
              <li key={b.code} className={`vm-badge vm-badge-${b.code}`}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                {b.text}
              </li>
            ))}
          </ul>
        )}
      </header>
      {!ranked && <p className="vm-muted vm-small">אפשרות לבחינה, ללא דירוג.</p>}

      <section className="vm-card-sec">
        <h4 className="vm-h4">{RESULTS.why}</h4>
        <ul className="vm-list">
          {o.reasons.map((r) => <li key={r.code}>{r.text}</li>)}
        </ul>
      </section>

      <section className="vm-card-sec">
        <h4 className="vm-h4">{RESULTS.consider}</h4>
        {shownConsiderations.length > 0 ? (
          <ul className="vm-list vm-list-warn">
            {shownConsiderations.map((c) => <li key={c}>{c}</li>)}
          </ul>
        ) : (
          <p className="vm-small vm-muted">כדאי לראות את הרכב מקרוב לפני החלטה.</p>
        )}
        {restConsiderations.length > 0 && (
          <details className="vm-details">
            <summary>עוד {restConsiderations.length} שיקולים</summary>
            <ul className="vm-list vm-list-warn">{restConsiderations.map((c) => <li key={c}>{c}</li>)}</ul>
          </details>
        )}
      </section>


      <section className="vm-net" aria-label={RESULTS.netHeading}>
        {o.net.status === "ok" ? (
          <>
            <div className="vm-net-head">
              {RESULTS.netHeading} מול {o.net.baselineName ?? "הרכב הנוכחי שלך"}
            </div>
            <div className={`vm-net-val ${o.net.netDelta < 0 ? "is-neg" : "is-pos"}`}>
              <bdi dir="ltr">{signedShekel(o.net.netDelta)}</bdi>
              <span className="vm-net-sign">{o.net.netDelta < 0 ? "פחות" : "יותר"}</span>
            </div>
            <details className="vm-details">
              <summary>{RESULTS.assumptions}</summary>
              <ul className="vm-list">
                <li>החישוב לפי כללי הנטו הקיימים ונתוני השכר שבתיק שלך.</li>
                {o.net.assumptions.map((a) => <li key={a}>{a}</li>)}
              </ul>
            </details>
          </>
        ) : (
          <p className="vm-net-missing">{RESULTS.netNeeds}</p>
        )}
      </section>

      {(o.specs.length > 0 || o.sources.length > 0) && (
        <details className="vm-details vm-sources">
          <summary>{RESULTS.specsAndSources}</summary>
          {o.specs.length > 0 && (
            <dl className="vm-specs">
              {o.specs.map((s) => (
                <div key={s.key} className="vm-spec">
                  <dt>{s.label}</dt>
                  <dd><bdi>{s.valueText}</bdi>{s.note && <span className="vm-spec-note">{s.note}</span>}</dd>
                </div>
              ))}
            </dl>
          )}
          {o.sources.length > 0 && <h5 className="vm-h5">{RESULTS.sources}</h5>}
          <ul className="vm-list">
            {o.sources.map((s) => (
              <li key={s.id}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.title}<span className="vm-sr-only"> (נפתח בלשונית חדשה)</span>
                </a>
                <span className="vm-muted vm-small"> · {MARKETS[s.market] ?? s.market}, {s.edition}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <button type="button" className="btn btn-graphite vm-compare" onClick={() => onPick(o.name)}>
        {RESULTS.compareCta}
      </button>
    </article>
  );
}
