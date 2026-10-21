// src/features/advisor/vehicle-match/VehicleMatchDrawer.tsx
"use client";
// מגירת "איזה רכב מתאים לי?": דיאלוג מודאלי נגיש (focus trap, Escape, החזרת פוקוס להורה,
// הרקע inert). בדסקטופ - מגירה משמאל; בנייד - מסך מלא. שאלון בן 4 שלבים -> תוצאות.
// החישוב כולו בשרת/בקוד (ללא מודל). המצב נשמר ב-sessionStorage לפי משתמש/ת ובירור.
// התנועה (transform/opacity בלבד) מתכבה בתנועה מופחתת וב"עצירת אנימציות" של תפריט הנגישות.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { runVehicleMatch } from "../../../app/vehicle-match-actions.js";
import type { VehicleMatchResponse } from "../../../server/services/vehicle-match-service.js";
import { asComplete, isStepComplete } from "../../../domain/vehicle-match/schema.js";
import type { QuestionnaireAnswers } from "../../../domain/vehicle-match/types.js";
import { LightTrail } from "../../brand/LightTrail.js";
import { ChoiceGroup } from "./ChoiceGroup.js";
import { DrawerNetwork } from "./DrawerNetwork.js";
import { GroupPrompt, MatchResults } from "./MatchResults.js";
import {
  CARGO, CHARGING, FEATURE_NAME, INTRO, PASSENGERS, PRIORITY, Q, RESULTS, SEATS_MIN, TRIPS, answersSummary,
} from "./copy.js";
import {
  INITIAL_STATE, answersSignature, comparePrompt, getCachedResult, loadMatchState, saveMatchState,
  scopeKey, setCachedResult, type GroupChoice, type PersistedMatchState,
} from "./match-state.js";

const CLOSE_MS = 170;
const LEAVE_MS = 190;
const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

type OkResponse = Extract<VehicleMatchResponse, { status: "ok" }>;
type Resp =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "auth" }
  | { kind: "done"; data: OkResponse };

type StepNo = 1 | 2 | 3 | 4;

function motionOff(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    || document.documentElement.hasAttribute("data-a11y-stopmotion");
}

export interface VehicleMatchDrawerProps {
  open: boolean;
  /** סגירה ביוזמת המשתמש/ת (Escape / X / רקע). ההורה מחזיר פוקוס לכפתור הפתיחה. */
  onClose: () => void;
  /** סגירה + הכנת טקסט בתיבת ההקלדה (בלי שליחה). */
  onPrefill: (text: string) => void;
  userId: string;
  /** מזהה הבירור הפעיל, או null בשיחה חדשה. */
  caseId: string | null;
}

export function VehicleMatchDrawer(props: VehicleMatchDrawerProps) {
  const { open, onClose } = props;
  const [render, setRender] = useState(open);
  const [closing, setClosing] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  // מחזור חיים: פתיחה מיידית; סגירה עם מעבר קצר שאינו מעכב את הפעולה (ההורה כבר עודכן).
  useEffect(() => {
    if (open) { setRender(true); setClosing(false); return; }
    if (!render) return;
    setClosing(true);
    const t = window.setTimeout(() => { setRender(false); setClosing(false); }, CLOSE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // הרקע אינו פעיל כשהמגירה פתוחה: inert על כל אחי ה-portal ב-body + נעילת גלילה.
  useEffect(() => {
    if (!open || !render) return;
    const root = rootRef.current;
    const touched: HTMLElement[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el === root || !(el instanceof HTMLElement) || el.tagName === "SCRIPT") continue;
      if (!el.inert) { el.inert = true; touched.push(el); }
    }
    document.documentElement.classList.add("vm-open");
    return () => {
      for (const el of touched) el.inert = false;
      document.documentElement.classList.remove("vm-open");
    };
  }, [open, render]);

  // Escape + מלכודת פוקוס (ברמת המסמך, כדי לעבוד גם כשהפוקוס אינו על אלמנט בתוך הפאנל).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && panel.contains(active);
      if (!inside) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!render || typeof document === "undefined") return null;
  return createPortal(
    <div ref={rootRef} className={`vm-root ${closing ? "is-closing" : ""}`.trim()}>
      <div className="vm-backdrop" onClick={onClose} aria-hidden="true" />
      <DrawerPanel {...props} panelRef={panelRef} />
    </div>,
    document.body,
  );
}

function DrawerPanel({
  onClose, onPrefill, userId, caseId, panelRef,
}: VehicleMatchDrawerProps & { panelRef: React.MutableRefObject<HTMLElement | null> }) {
  const titleId = useId();
  const key = scopeKey(userId, caseId);
  const [st, setSt] = useState<PersistedMatchState>(() =>
    typeof window === "undefined" ? INITIAL_STATE : (loadMatchState(window.sessionStorage, key) ?? INITIAL_STATE));
  // פתיחה חוזרת באמצע דרך: מציגים הודעה קצרה + התחלה מחדש. הפתיחה (intro) מוצגת רק בפעם הראשונה.
  const [resumed, setResumed] = useState(st.view !== "intro");
  const [resp, setResp] = useState<Resp>(() => {
    if (st.view !== "results") return { kind: "idle" };
    const hit = getCachedResult<OkResponse>(key, answersSignature(st));
    return hit ? { kind: "done", data: hit } : { kind: "idle" };
  });
  const reqId = useRef(0);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  // כיוון המעבר: 0 = ללא (טעינה ראשונה), 1 = קדימה, -1 = אחורה. leaving = אנימציית יציאה בתהליך.
  const [dir, setDir] = useState<0 | 1 | -1>(0);
  const [leaving, setLeaving] = useState(false);
  const transitioning = useRef(false);

  // שמירה: רק העדפות; המפתח כולל משתמש/ת ובירור.
  useEffect(() => { saveMatchState(window.sessionStorage, key, st); }, [key, st]);

  const update = useCallback((patch: Partial<PersistedMatchState>) => setSt((s) => ({ ...s, ...patch })), []);
  const setAnswers = useCallback((patch: Partial<QuestionnaireAnswers>) =>
    setSt((s) => ({ ...s, answers: { ...s.answers, ...patch } })), []);

  /** מעבר עם תנועה: היציאה קצרה (~190ms), ואז הכניסה המשלימה. בתנועה מופחתת - מיידי. */
  const go = useCallback((apply: () => void, d: 1 | -1) => {
    if (transitioning.current) return;
    setResumed(false);
    setDir(d);
    if (motionOff()) { apply(); return; }
    transitioning.current = true;
    setLeaving(true);
    window.setTimeout(() => { apply(); setLeaving(false); transitioning.current = false; }, LEAVE_MS);
  }, []);

  const run = useCallback(async (group: GroupChoice | null, silent = false) => {
    const complete = asComplete(st.answers);
    if (!complete) { update({ view: "questions", step: 1 }); return; }
    const id = ++reqId.current;
    if (!silent) setResp({ kind: "loading" });
    try {
      const res = await runVehicleMatch({
        answers: complete, caseId, groupOverride: group, saveGroup: group !== null,
      });
      if (id !== reqId.current) return; // תשובה ישנה - מתעלמים
      if (res.status === "ok") {
        setCachedResult(key, answersSignature({ answers: st.answers, groupChoice: group }), res);
        setResp({ kind: "done", data: res });
      } else if (!silent) {
        setResp({ kind: res.status === "auth" ? "auth" : "error" });
      }
    } catch {
      if (id === reqId.current && !silent) setResp({ kind: "error" });
    }
  }, [st.answers, caseId, key, update]);

  // כניסה למסך תוצאות => חישוב מהתשובות השמורות (בקוד, בלי מודל).
  useEffect(() => {
    if (st.view === "results" && resp.kind === "idle") void run(st.groupChoice);
  }, [st.view, st.groupChoice, resp.kind, run]);
  // פתיחה מחדש עם תוצאות במטמון: מוצגות מיד, ומתרעננות ברקע (ייתכן שהנתונים בשיחה השתנו).
  const refreshed = useRef(false);
  useEffect(() => {
    if (refreshed.current) return;
    refreshed.current = true;
    if (st.view === "results" && resp.kind === "done") void run(st.groupChoice, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // פוקוס לכותרת הפעילה בכל מעבר שלב/מסך (קוראי מסך + מקלדת).
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [st.view, st.step, resp.kind]);

  function finish(): void {
    go(() => { setResp({ kind: "idle" }); update({ view: "results" }); }, 1);
  }
  function restart(): void {
    reqId.current++;
    setDir(-1);
    setResumed(false);
    setResp({ kind: "idle" });
    setSt(INITIAL_STATE);
  }
  function edit(): void {
    reqId.current++;
    go(() => { setResp({ kind: "idle" }); update({ view: "questions", step: 1 }); }, -1);
  }
  const toStep = (n: StepNo, d: 1 | -1): void => go(() => update({ step: n }), d);

  const step = st.step as StepNo;
  const a = st.answers;
  const stepOk = isStepComplete(step, a);
  const viewKey = `${st.view}-${st.step}-${resp.kind === "done" ? "d" : "x"}`;
  const viewClass = `vm-view ${leaving ? "is-leaving" : dir !== 0 ? "is-entering" : ""} ${dir === -1 ? "dir-back" : "dir-fwd"}`.trim();
  // מוקדי הקישוט: אחד לכל שאלה שאושרה; בתוצאות - כולם מחוברים.
  const lit = st.view === "results" ? 4 : st.view === "questions" ? step - 1 : 0;
  // רוחב הפס: שאלה 1 = רבע, ... תוצאות = מלא. במסך הפתיחה רק קצה זוהר קטן.
  const barPct = st.view === "results" ? 100 : st.view === "questions" ? step * 25 : 3;

  return (
    <section ref={panelRef} className="vm-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      {/* פס ההתקדמות הצבעוני בראש המגירה: מתמלא עם התקדמות השאלון (ללא אחוזים מומצאים). */}
      <div className="vm-topbar" aria-hidden="true">
        <i className="vm-topbar-fill" style={{ width: `${barPct}%` }}>
          <b key={`${st.view}-${st.step}`} className="vm-topbar-spark" />
        </i>
      </div>
      <DrawerNetwork lit={lit} connected={st.view === "results" && resp.kind === "done"} />
      <header className="vm-head">
        <h2 id={titleId} className="vm-eyebrow">
          <SparkleIcon /> {FEATURE_NAME}
        </h2>
        <div className="vm-head-actions">
          {st.view !== "intro" && (
            <button type="button" className="btn btn-ghost vm-restart" onClick={restart}>{RESULTS.restart}</button>
          )}
          <button type="button" className="icon-btn vm-close" onClick={onClose} aria-label="סגירה">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </header>

      <div className="vm-body scroll-y">
        {resumed && st.view !== "intro" && (
          <p className="vm-resumed" role="status">
            {INTRO.resumed}{" "}
            <button type="button" className="vm-link" onClick={restart}>{RESULTS.restart}</button>
          </p>
        )}

        {st.view === "questions" && (
          <p id="vm-progress-text" className="vm-progress-text">שאלה {step} מתוך 4</p>
        )}

        <div key={viewKey} className={viewClass}>
          {st.view === "intro" && (
            <div className="vm-intro vm-stagger">
              <LightTrail mode="idle" variant="band" className="vm-trail" />
              <h3 ref={headingRef} tabIndex={-1} className="vm-hero-title" style={{ ["--s" as string]: "0" }}>
                {INTRO.titleParts.map((p) => <span key={p} className="vm-nobreak">{p} </span>)}
              </h3>
              <div className="vm-intro-body" style={{ ["--s" as string]: "1" }}>
                {INTRO.lines.map((l) => <p key={l} className="vm-lead-line">{l}</p>)}
              </div>
              <button
                type="button" className="btn vm-cta vm-cta-go" style={{ ["--s" as string]: "2" }}
                onClick={() => go(() => update({ view: "questions" }), 1)}
              >
                <span className="vm-cta-label">{INTRO.cta}</span>
                <span className="vm-cta-orb" aria-hidden="true"><ArrowLeft size={18} className="vm-cta-arrow" /></span>
              </button>
              <p className="vm-muted vm-small" style={{ ["--s" as string]: "3" }}>{INTRO.small}</p>
            </div>
          )}

          {st.view === "questions" && (
            <>
              {step === 1 && (
                <>
                  <h3 ref={headingRef} tabIndex={-1} id="vm-q1" className="vm-q-title">{Q[1].title}</h3>
                  <p className="vm-q-lead">{Q[1].lead}</p>
                  <p id="vm-q1-hint" className="vm-hint">{Q[1].hint}</p>
                  <ChoiceGroup
                    name="vm-passengers" labelledBy="vm-q1" describedBy="vm-q1-hint" choices={PASSENGERS} value={a.passengers}
                    onChange={(v) => setAnswers({ passengers: v, seatsMin: v === "many" ? a.seatsMin : null })}
                  />
                  {a.passengers === "many" && (
                    <div className="vm-sub">
                      <h4 id="vm-q1-sub" className="vm-h4">{Q[1].sub}</h4>
                      <p id="vm-q1-subhint" className="vm-hint">{Q[1].subHint}</p>
                      <ChoiceGroup
                        name="vm-seats" labelledBy="vm-q1-sub" describedBy="vm-q1-subhint" choices={SEATS_MIN} value={a.seatsMin}
                        onChange={(v) => setAnswers({ seatsMin: v })} compact
                      />
                    </div>
                  )}
                </>
              )}

              {step === 2 && (
                <>
                  <h3 ref={headingRef} tabIndex={-1} id="vm-q2" className="vm-q-title">{Q[2].title}</h3>
                  <p className="vm-q-lead">{Q[2].lead}</p>
                  <p id="vm-q2-hint" className="vm-hint">{Q[2].hint}</p>
                  <ChoiceGroup name="vm-cargo" labelledBy="vm-q2" describedBy="vm-q2-hint" choices={CARGO} value={a.cargo} onChange={(v) => setAnswers({ cargo: v })} />
                  {a.cargo === "stroller" && <p className="vm-note" role="note">{Q[2].strollerNote}</p>}
                </>
              )}

              {step === 3 && (
                <>
                  <h3 ref={headingRef} tabIndex={-1} id="vm-q3" className="vm-q-title">{Q[3].title}</h3>
                  <p className="vm-q-lead">{Q[3].lead}</p>
                  <p id="vm-q3-hint" className="vm-hint">{Q[3].hint}</p>
                  <ChoiceGroup name="vm-trips" labelledBy="vm-q3" describedBy="vm-q3-hint" choices={TRIPS} value={a.trips} onChange={(v) => setAnswers({ trips: v })} />
                  <div className="vm-sub">
                    <h4 id="vm-q3-sub" className="vm-h4">{Q[3].sub}</h4>
                    <p id="vm-q3-subhint" className="vm-hint">{Q[3].subHint}</p>
                    <ChoiceGroup
                      name="vm-charging" labelledBy="vm-q3-sub" describedBy="vm-q3-subhint" choices={CHARGING}
                      value={a.charging} onChange={(v) => setAnswers({ charging: v })} compact
                    />
                  </div>
                </>
              )}

              {step === 4 && (
                <>
                  <h3 ref={headingRef} tabIndex={-1} id="vm-q4" className="vm-q-title">{Q[4].title}</h3>
                  <p className="vm-q-lead">{Q[4].lead}</p>
                  <p id="vm-q4-hint" className="vm-hint">{Q[4].hint}</p>
                  <ChoiceGroup name="vm-priority" labelledBy="vm-q4" describedBy="vm-q4-hint" choices={PRIORITY} value={a.priority} onChange={(v) => setAnswers({ priority: v })} />
                </>
              )}
            </>
          )}

          {st.view === "results" && (
            resp.kind === "loading" || resp.kind === "idle" ? (
              <>
                <h3 ref={headingRef} tabIndex={-1} className="vm-q-title">{RESULTS.title}</h3>
                <p role="status" className="vm-loading">{RESULTS.loading}</p>
              </>
            ) : resp.kind === "error" || resp.kind === "auth" ? (
              <>
                <h3 ref={headingRef} tabIndex={-1} className="vm-q-title">{RESULTS.title}</h3>
                <p role="alert" className="vm-error">
                  {resp.kind === "auth" ? "ההתחברות פגה. יש להתחבר מחדש כדי להמשיך." : "לא הצלחנו להציג אפשרויות כרגע. אפשר לנסות שוב."}
                </p>
                <div className="vm-actions-row">
                  {resp.kind === "error" && <button type="button" className="btn btn-graphite" onClick={() => void run(st.groupChoice)}>ניסיון נוסף</button>}
                  {resp.kind === "auth" && <a className="btn btn-graphite" href="/login">להתחברות</a>}
                  <button type="button" className="btn btn-ghost" onClick={edit}>{RESULTS.edit}</button>
                </div>
              </>
            ) : resp.data.result.status === "needs_eligibility_group" ? (
              <>
                <h3 ref={headingRef} tabIndex={-1} className="vm-q-title">עוד פרט אחד לפני שנציג אפשרויות</h3>
                <GroupPrompt
                  hasCase={resp.data.hasCase}
                  value={st.groupChoice}
                  onChange={(g) => update({ groupChoice: g })}
                  onSubmit={() => { setResp({ kind: "idle" }); }}
                  onAskInChat={() => onPrefill("אשמח לברר מהי קבוצת הזכאות שלי.")}
                />
              </>
            ) : (
              <>
                <h3 ref={headingRef} tabIndex={-1} className="vm-q-title vm-rise" style={{ ["--s" as string]: "0" }}>{RESULTS.title}</h3>
                <p className="vm-q-lead vm-rise" style={{ ["--s" as string]: "1" }}>{RESULTS.lead}</p>
                <MatchResults
                  result={resp.data.result}
                  hasCase={resp.data.hasCase}
                  summary={answersSummary(st.answers)}
                  onEdit={edit}
                  onPick={(name) => onPrefill(comparePrompt(name))}
                />
              </>
            )
          )}
        </div>
      </div>

      {st.view === "questions" && (
        <footer className="vm-foot">
          <button
            type="button" className="btn vm-prev"
            onClick={() => (step === 1 ? go(() => update({ view: "intro" }), -1) : toStep((step - 1) as StepNo, -1))}
          >
            <ArrowRight size={16} aria-hidden={true} className="vm-arrow vm-arrow-back" /> {RESULTS.prev}
          </button>
          {step < 4 ? (
            <button type="button" className="btn btn-graphite vm-next" disabled={!stepOk} onClick={() => toStep((step + 1) as StepNo, 1)}>
              {RESULTS.next} <ArrowLeft size={16} aria-hidden={true} className="vm-arrow" />
            </button>
          ) : (
            <button type="button" className="btn btn-graphite vm-next vm-finish" disabled={!stepOk} onClick={finish}>
              {RESULTS.finish} <ArrowLeft size={16} aria-hidden={true} className="vm-arrow" />
            </button>
          )}
        </footer>
      )}
    </section>
  );
}

export function SparkleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="vm-sparkle">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" fill="currentColor" />
    </svg>
  );
}
