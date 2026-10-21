"use client";

/**
 * תוסף נגישות (Accessibility Overlay)
 * ----------------------------------
 * ווידג'ט נגישות עצמאי, ללא תלות בספריות חיצוניות. נטען בצד הלקוח בלבד.
 * כל ההתאמות נשמרות ב-localStorage ומוחלות מחדש בטעינת העמוד.
 *
 * הפיצ'רים: הגדלת/הקטנת טקסט, מרווח שורות, רווח בין אותיות, גופן קריא,
 * ניגודיות גבוהה, גווני אפור, היפוך צבעים, הדגשת קישורים, עצירת אנימציות,
 * סמן גדול, קו קריאה (reading guide), ואיפוס הכל.
 *
 * הערות נגישות: ניתן לתפעול מלא במקלדת, תוויות ARIA בעברית, לכידת פוקוס
 * בפאנל הפתוח, וסגירה ב-Escape.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { FaWheelchair } from "react-icons/fa";

type Toggles = {
  highContrast: boolean;
  grayscale: boolean;
  invert: boolean;
  highlightLinks: boolean;
  readableFont: boolean;
  stopAnimations: boolean;
  bigCursor: boolean;
  readingGuide: boolean;
};

type Settings = {
  fontScale: number; // 0..6 צעדים של 10%
  lineSpacing: number; // 0..3
  letterSpacing: number; // 0..3
  toggles: Toggles;
};

const STORAGE_KEY = "a11y-settings-v1";

const DEFAULT_SETTINGS: Settings = {
  fontScale: 0,
  lineSpacing: 0,
  letterSpacing: 0,
  toggles: {
    highContrast: false,
    grayscale: false,
    invert: false,
    highlightLinks: false,
    readableFont: false,
    stopAnimations: false,
    bigCursor: false,
    readingGuide: false,
  },
};

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      toggles: { ...DEFAULT_SETTINGS.toggles, ...(parsed.toggles ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** מחיל את ההגדרות על שורש המסמך דרך data-attributes ומשתני CSS. */
function applySettings(s: Settings) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  root.style.setProperty("--a11y-font-scale", String(1 + s.fontScale * 0.1));
  root.style.setProperty("--a11y-line", String(1.6 + s.lineSpacing * 0.35));
  root.style.setProperty("--a11y-letter", `${s.letterSpacing * 0.06}em`);

  const t = s.toggles;
  root.toggleAttribute("data-a11y-contrast", t.highContrast);
  root.toggleAttribute("data-a11y-grayscale", t.grayscale);
  root.toggleAttribute("data-a11y-invert", t.invert);
  root.toggleAttribute("data-a11y-links", t.highlightLinks);
  root.toggleAttribute("data-a11y-readable", t.readableFont);
  root.toggleAttribute("data-a11y-stopmotion", t.stopAnimations);
  root.toggleAttribute("data-a11y-bigcursor", t.bigCursor);
  root.toggleAttribute("data-a11y-active", hasAny(s));
}

function hasAny(s: Settings): boolean {
  return (
    s.fontScale !== 0 ||
    s.lineSpacing !== 0 ||
    s.letterSpacing !== 0 ||
    Object.values(s.toggles).some(Boolean)
  );
}

export default function AccessibilityWidget() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);

  // טעינה ראשונית מ-localStorage והחלה.
  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    applySettings(s);
    setMounted(true);
  }, []);

  // שמירה + החלה בכל שינוי.
  useEffect(() => {
    if (!mounted) return;
    applySettings(settings);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* התעלמות - אחסון לא זמין */
    }
  }, [settings, mounted]);

  // קו קריאה שעוקב אחרי העכבר.
  useEffect(() => {
    if (!settings.toggles.readingGuide) return;
    const el = guideRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      el.style.top = `${e.clientY}px`;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [settings.toggles.readingGuide]);

  // Escape לסגירה + החזרת פוקוס לכפתור.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // פוקוס לפאנל כשהוא נפתח.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const setToggle = useCallback((key: keyof Toggles) => {
    setSettings((s) => ({
      ...s,
      toggles: { ...s.toggles, [key]: !s.toggles[key] },
    }));
  }, []);

  const step = useCallback(
    (key: "fontScale" | "lineSpacing" | "letterSpacing", dir: 1 | -1, max: number) => {
      setSettings((s) => {
        const next = Math.min(max, Math.max(0, s[key] + dir));
        return { ...s, [key]: next };
      });
    },
    [],
  );

  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  if (!mounted) return null;

  const active = hasAny(settings);

  return (
    <>
      {settings.toggles.readingGuide && (
        <div ref={guideRef} className="a11y-reading-guide" aria-hidden="true" />
      )}

      <button
        ref={triggerRef}
        type="button"
        className="a11y-fab"
        aria-label="תפריט נגישות"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="תפריט נגישות"
        onClick={() => setOpen((o) => !o)}
      >
        <FaWheelchair size={26} aria-hidden="true" style={{ transform: "scaleX(-1)" }} />
        {active && <span className="a11y-fab-dot" aria-hidden="true" />}
      </button>

      {open && (
        <>
          <div
            className="a11y-backdrop"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="תפריט נגישות"
            tabIndex={-1}
            className="a11y-panel"
          >
            <div className="a11y-head">
              <strong>תפריט נגישות</strong>
              <button
                type="button"
                className="a11y-close"
                aria-label="סגירת תפריט נגישות"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                ✕
              </button>
            </div>

            <div className="a11y-body">
              <div className="a11y-group" role="group" aria-label="גודל והתאמת טקסט">
                <Stepper
                  label="גודל טקסט"
                  value={settings.fontScale}
                  max={6}
                  onDec={() => step("fontScale", -1, 6)}
                  onInc={() => step("fontScale", 1, 6)}
                />
                <Stepper
                  label="מרווח שורות"
                  value={settings.lineSpacing}
                  max={3}
                  onDec={() => step("lineSpacing", -1, 3)}
                  onInc={() => step("lineSpacing", 1, 3)}
                />
                <Stepper
                  label="מרווח אותיות"
                  value={settings.letterSpacing}
                  max={3}
                  onDec={() => step("letterSpacing", -1, 3)}
                  onInc={() => step("letterSpacing", 1, 3)}
                />
              </div>

              <div className="a11y-grid" role="group" aria-label="התאמות תצוגה">
                <ToggleBtn label="ניגודיות גבוהה" on={settings.toggles.highContrast} onClick={() => setToggle("highContrast")} />
                <ToggleBtn label="גווני אפור" on={settings.toggles.grayscale} onClick={() => setToggle("grayscale")} />
                <ToggleBtn label="היפוך צבעים" on={settings.toggles.invert} onClick={() => setToggle("invert")} />
                <ToggleBtn label="הדגשת קישורים" on={settings.toggles.highlightLinks} onClick={() => setToggle("highlightLinks")} />
                <ToggleBtn label="גופן קריא" on={settings.toggles.readableFont} onClick={() => setToggle("readableFont")} />
                <ToggleBtn label="עצירת אנימציות" on={settings.toggles.stopAnimations} onClick={() => setToggle("stopAnimations")} />
                <ToggleBtn label="סמן גדול" on={settings.toggles.bigCursor} onClick={() => setToggle("bigCursor")} />
                <ToggleBtn label="קו קריאה" on={settings.toggles.readingGuide} onClick={() => setToggle("readingGuide")} />
              </div>

              <button type="button" className="a11y-reset" onClick={reset}>
                איפוס כל ההתאמות
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Stepper({
  label,
  value,
  max,
  onDec,
  onInc,
}: {
  label: string;
  value: number;
  max: number;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <div className="a11y-stepper">
      <span className="a11y-stepper-label">{label}</span>
      <div className="a11y-stepper-ctrl">
        <button type="button" aria-label={`הקטנת ${label}`} onClick={onDec} disabled={value <= 0}>
          −
        </button>
        <span className="a11y-stepper-val" aria-live="polite">
          {value}/{max}
        </span>
        <button type="button" aria-label={`הגדלת ${label}`} onClick={onInc} disabled={value >= max}>
          +
        </button>
      </div>
    </div>
  );
}

function ToggleBtn({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`a11y-toggle${on ? " is-on" : ""}`}
      aria-pressed={on}
      onClick={onClick}
    >
      <span className="a11y-toggle-check" aria-hidden="true">
        {on ? "✓" : ""}
      </span>
      {label}
    </button>
  );
}


