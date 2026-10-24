// src/features/advisor/ConversationSidebar.tsx
"use client";
// סרגל צד של היסטוריית הבירורים (בסגנון שיחות): "שיחה חדשה" למעלה, ואז רשימת
// הבירורים עם הדגשת הפעיל. בדסקטופ קבוע לצד השיחה; בנייד מגירה שנפתחת בכפתור.
//
// הבעלות והשחזור נשארים בשרת: כל פריט שולח את ה-server action continueInquiry
// (מאמת בעלות, מגדיר cookie, ומפנה ל-/?c=). "שיחה חדשה" -> startNewInquiry.
// אין כאן לוגיקה עסקית - ניווט בלבד.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { continueInquiry, clearActiveInquiry, deleteInquiry } from "../../app/inquiry-actions.js";
import { clearNewScopeState } from "./vehicle-match/match-state.js";

export type ConversationSummary = {
  caseId: string;
  title: string | null;
  messageCount: number;
  hasComparison: boolean;
  hasOpenInquiry: boolean;
  updatedAt: string;
};

function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeZone: "Asia/Jerusalem" }).format(new Date(iso));
  } catch { return iso.slice(0, 10); }
}

export function ConversationSidebar({
  summaries,
  activeCaseId,
}: {
  summaries: ConversationSummary[];
  activeCaseId: string | null;
}) {
  const [open, setOpen] = useState(false); // מצב מגירת הנייד
  const [mounted, setMounted] = useState(false); // ל-portal (זמין רק בצד הלקוח)
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const drawerRootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || !mounted) return;
    const root = drawerRootRef.current;
    if (!root) return;
    const inerted: HTMLElement[] = [];
    const previousOverflow = document.body.style.overflow;
    for (const child of Array.from(document.body.children)) {
      if (child === root || !(child instanceof HTMLElement) || child.tagName === "SCRIPT") continue;
      if (!child.inert) { child.inert = true; inerted.push(child); }
    }
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )).filter((el) => el.offsetParent !== null);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      else if (!root.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      for (const child of inerted) child.inert = false;
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => openerRef.current?.focus());
    };
  }, [open, mounted]);

  // סוגרים את המגירה רק אחרי שאירוע ה-submit כבר נשלח. סגירה סינכרונית ב-onClick
  // מסירה את ה-<form> מה-DOM לפני שהדפדפן מבצע את השליחה, ולכן ה-server action
  // לא רץ ו"כלום לא קורה".
  const closeAfterSubmit = () => {
    setTimeout(() => setOpen(false), 0);
  };

  async function startNew() {
    try {
      // שיחה חדשה מתחילה בלי תשובות שאלון קודמות של שיחה חדשה שטרם נפתח לה בירור.
      clearNewScopeState(window.sessionStorage);
      await clearActiveInquiry();
    } finally {
      window.location.assign("/");
    }
  }

  const list = (
    <nav className="sidebar-nav" aria-label="היסטוריית בירורים">
      {/* טעינה מלאה (ולא ניווט צד-לקוח): מאפסת את מצב useChat גם אם השיחה
          הנוכחית נפתחה מ-"/" ועדכנה את ה-URL ב-replaceState. */}
      <button type="button" className="btn btn-graphite sidebar-new" onClick={startNew}>
        <PlusIcon /> שיחה חדשה
      </button>

      <div className="sidebar-list scroll-y">
        {summaries.length === 0 ? (
          <p className="sidebar-empty">אין עדיין בירורים. השיחה הראשונה תופיע כאן.</p>
        ) : (
          summaries.map((s) => {
            const isActive = s.caseId === activeCaseId;
            return (
              <div key={s.caseId} className={`sidebar-item-wrap ${isActive ? "is-active" : ""}`.trim()}>
                {/* ניווט לבירור (טופס נפרד מכפתור המחיקה - אין קינון טפסים). */}
                <form action={continueInquiry} className="sidebar-item-form">
                  <input type="hidden" name="caseId" value={s.caseId} />
                  <button
                    type="submit"
                    className="sidebar-item"
                    aria-current={isActive ? "page" : undefined}
                    onClick={closeAfterSubmit}
                  >
                    <span className="sidebar-item-title">{s.title ?? "שיחה חדשה"}</span>
                    <span className="sidebar-item-meta">
                      <span>{fmtDate(s.updatedAt)}</span>
                      {s.hasComparison && <span className="sidebar-dot sidebar-dot-teal" title="יש השוואה" />}
                      {s.hasOpenInquiry && <span className="sidebar-dot sidebar-dot-orange" title="ממתין לנציג" />}
                    </span>
                  </button>
                </form>
                {/* מחיקה: מופיעה ב-hover/focus; מאשרת לפני שליחה. */}
                <form
                  action={deleteInquiry}
                  className="sidebar-del-form"
                  onSubmit={(e) => { if (!confirm("למחוק את השיחה? פעולה זו אינה הפיכה.")) e.preventDefault(); }}
                >
                  <input type="hidden" name="caseId" value={s.caseId} />
                  <input type="hidden" name="isActive" value={isActive ? "1" : "0"} />
                  <button type="submit" className="sidebar-del" aria-label={`מחיקת השיחה: ${s.title ?? "שיחה"}`} title="מחיקה">
                    <TrashIcon />
                  </button>
                </form>
              </div>
            );
          })
        )}
      </div>
    </nav>
  );

  return (
    <>
      {/* כפתור פתיחת מגירת ההיסטוריה (תמיד; הסרגל נסתר כברירת מחדל). */}
      <button
        ref={openerRef}
        type="button"
        className="sidebar-toggle"
        aria-label="היסטוריית שיחות"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <MenuIcon />
      </button>
      {/* המגירה מרונדרת דרך portal ל-body כדי לצאת מה-stacking context של הכותרת,
          אחרת היא נפתחת מאחורי כרטיס הצ'אט. */}
      {open && mounted && createPortal(
        <div ref={drawerRootRef} className="sidebar-backdrop drawer-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <aside
            className="sidebar sidebar-mobile drawer-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="היסטוריית בירורים"
          >
            <div className="sidebar-mobile-head">
              <span>הבירורים שלי</span>
              <button type="button" className="icon-btn" aria-label="סגירה" onClick={() => setOpen(false)}><CloseIcon /></button>
            </div>
            {list}
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
}

function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}
function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function MenuIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}
function CloseIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}
