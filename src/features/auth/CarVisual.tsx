// src/features/auth/CarVisual.tsx
"use client";
// שכבת האיור של מסך הכניסה: רכב-רשת (אזור האיור הנקי) על רקע פנינה + שכבת חיים
// עדינה (נקודות אור נושמות, פולסים על מסלולי הצבע, parallax עכבר במחשב).
//
// הפרדת מעטפות (קריטי לשמירת החיתוך):
//   .car-visual          - מעטפת מיקום קבועה (inset:0, overflow:hidden). לא זזה.
//   .car-visual-motion   - מעטפת תנועה: עליה מוחל ה-parallax (translate קטן).
//                          ה-transform כאן לא נוגע ב-object-position/fit של התמונה.
//   .car-visual-img      - התמונה: object-fit/position נקבעים ב-CSS בלבד.
// כך אנימציית ה-parallax לא דורסת את מיקום/יחס האיור.
//
// נגישות/ביצועים: כל השכבות דקורטיביות (aria-hidden, pointer-events:none).
// parallax דרך CSS variables + requestAnimationFrame (בלי setState לכל תנועה).
// נעצר כשהאיור מחוץ למסך או כשהלשונית מוסתרת, ובנייד/reduced-motion מושבת.

import { useEffect, useRef } from "react";

const CAR_SRC = "/brand/neural-car-hero.png";
const PEARL = "#f6f3ee";
const PEARL_RGB = "246, 243, 238";

// נקודות אור נושמות - מיקומים נבחרים על רשת הרכב (אחוזי מעטפת). לא אקראי.
const GLOW_DOTS: Array<{ x: number; y: number; d: number; delay: number }> = [
  { x: 30, y: 58, d: 7, delay: 0.0 },
  { x: 48, y: 50, d: 5, delay: 1.3 },
  { x: 62, y: 60, d: 6, delay: 2.1 },
  { x: 40, y: 40, d: 4, delay: 0.8 },
  { x: 55, y: 68, d: 4, delay: 1.7 },
  { x: 36, y: 66, d: 5, delay: 2.6 },
  { x: 52, y: 44, d: 3, delay: 0.4 },
  { x: 44, y: 72, d: 4, delay: 3.1 },
];

// פולסים הנעים לאורך מסלולי הצבע (כתום/ירוק/כחול) + מסלול כחול שני.
const PULSES: Array<{ cls: string; delay: number }> = [
  { cls: "car-pulse-orange", delay: 0 },
  { cls: "car-pulse-green", delay: 1.1 },
  { cls: "car-pulse-blue", delay: 2.2 },
  { cls: "car-pulse-orange2", delay: 3.3 },
];

export function CarVisual({ mode }: { mode: "desktop" | "mobile" }) {
  const isMobile = mode === "mobile";
  const rootRef = useRef<HTMLDivElement | null>(null);
  const motionRef = useRef<HTMLDivElement | null>(null);

  // Parallax עדין (מחשב בלבד). מעדכן CSS variables דרך rAF, בלי React state.
  // נעצר תחת reduced-motion, בנייד, כשמחוץ למסך, או כשהלשונית מוסתרת.
  useEffect(() => {
    if (isMobile) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(pointer: fine)");
    if (mql.matches || !finePointer.matches) return;

    const motion = motionRef.current;
    const root = rootRef.current;
    if (!motion || !root) return;

    let raf = 0;
    let visible = true;
    let onScreen = true;

    const io = new IntersectionObserver(
      (entries) => { onScreen = entries[0]?.isIntersecting ?? true; },
      { threshold: 0 }
    );
    io.observe(root);

    const onVis = () => { visible = document.visibilityState === "visible"; };
    document.addEventListener("visibilitychange", onVis);

    function onMove(e: PointerEvent) {
      if (!visible || !onScreen) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const nx = e.clientX / window.innerWidth - 0.5;   // -0.5..0.5
        const ny = e.clientY / window.innerHeight - 0.5;
        // עדין מאוד: עד ~3px, איטי ורך (ה-transition ב-CSS). לא חושף קצוות.
        motion!.style.setProperty("--px", `${(-nx * 3).toFixed(2)}px`);
        motion!.style.setProperty("--py", `${(-ny * 2).toFixed(2)}px`);
      });
    }
    window.addEventListener("pointermove", onMove, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVis);
      io.disconnect();
    };
  }, [isMobile]);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className={isMobile ? "car-visual car-visual-mobile" : "car-visual car-visual-desktop"}
      style={{ background: PEARL }}
    >
      {/* מעטפת תנועה: parallax בלבד (translate מ-CSS vars). לא נוגעת למיקום התמונה. */}
      <div ref={motionRef} className="car-visual-motion">
        <img src={CAR_SRC} alt="" className="car-visual-img" />

        {/* פולסים על מסלולי הצבע - דקורטיבי. */}
        {!isMobile && (
          <div className="car-pulses">
            {PULSES.map((p) => (
              <span key={p.cls} className={`car-pulse ${p.cls}`} style={{ animationDelay: `${p.delay}s` }} />
            ))}
          </div>
        )}

        {/* נקודות אור נושמות - מיקומים על רשת הרכב. */}
        <div className="car-glows">
          {GLOW_DOTS.map((g, i) => (
            <span
              key={i}
              className="car-glow"
              style={{ left: `${g.x}%`, top: `${g.y}%`, width: g.d, height: g.d, animationDelay: `${g.delay}s` }}
            />
          ))}
        </div>
      </div>

      {/* שכבות מיזוג לפנינה. ממוקמות על המעטפת הקבועה (לא זזות עם ה-parallax). */}
      <div className="car-fade car-fade-left"
        style={{ background: `linear-gradient(to right, ${PEARL} 0%, rgba(${PEARL_RGB}, 0) 100%)` }} />
      <div className="car-fade car-fade-right"
        style={{ background: `linear-gradient(to left, ${PEARL} 0%, ${PEARL} 22%, rgba(${PEARL_RGB}, 0) 100%)` }} />
      <div className="car-fade car-fade-top"
        style={{ background: `linear-gradient(to bottom, ${PEARL} 0%, rgba(${PEARL_RGB}, 0) 100%)` }} />
      <div className="car-fade car-fade-bottom"
        style={{ background: `linear-gradient(to top, ${PEARL} 0%, rgba(${PEARL_RGB}, 0) 100%)` }} />
    </div>
  );
}
