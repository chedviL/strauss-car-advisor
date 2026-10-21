// src/features/brand/LightTrail.tsx
"use client";
// מוטיב "מסלול אור" - שפת המותג המשותפת (נגזרת מאיור הכניסה):
// שלושה חוטים דקיקים בכתום/ירוק/תכלת עם צמתים זוהרים. SVG+CSS בלבד - חד, קל,
// ניתן להנעה בלי תמונה. דקורטיבי (aria-hidden, pointer-events:none).
//
// שלושה מצבים (mode):
//   "idle"   - הופעה עדינה ושקטה (פתיחת שיחה, מעל תיבת ההקלדה).
//   "active" - מחוון פעילות: הצמתים והזרימה מתחזקים (בזמן עבודת המודל).
//   "result" - נגיעה קצרה שמלווה הופעת תוצאה (כרטיס השוואה).
//
// variant="band" (ברירת מחדל) - רצועה אופקית רחבה (מעל קלט/כותרת).
// variant="inline" - גרסה קומפקטית קטנה (למשל ליד כותרת/סטטוס).

const THREADS = [
  { d: "M2 26 C 60 10, 120 12, 180 20 S 300 34, 358 20", color: "var(--brand-orange)" },
  { d: "M2 32 C 70 24, 130 30, 190 30 S 300 26, 358 30", color: "var(--brand-green)" },
  { d: "M2 38 C 64 46, 128 44, 188 40 S 300 30, 358 40", color: "var(--brand-teal)" },
];
// צמתים זוהרים על המסלולים (קואורדינטות בתוך ה-viewBox 360x56).
const NODES = [
  { x: 60, y: 14, color: "var(--brand-orange)", delay: 0 },
  { x: 190, y: 30, color: "var(--brand-green)", delay: 0.6 },
  { x: 300, y: 33, color: "var(--brand-teal)", delay: 1.2 },
  { x: 250, y: 24, color: "var(--brand-orange)", delay: 1.8 },
];

export function LightTrail({
  mode = "idle",
  variant = "band",
  className,
}: {
  mode?: "idle" | "active" | "result";
  variant?: "band" | "inline";
  className?: string;
}) {
  return (
    <div
      className={`light-trail light-trail-${variant} is-${mode} ${className ?? ""}`.trim()}
      aria-hidden="true"
    >
      <svg viewBox="0 0 360 56" fill="none" preserveAspectRatio="xMidYMid meet" role="presentation">
        {THREADS.map((t, i) => (
          <path
            key={i}
            className="lt-thread"
            d={t.d}
            stroke={t.color}
            strokeWidth="1.5"
            strokeLinecap="round"
            style={{ ["--i" as string]: String(i) }}
          />
        ))}
        {NODES.map((n, i) => (
          <circle
            key={i}
            className="lt-node"
            cx={n.x}
            cy={n.y}
            r="2.4"
            fill={n.color}
            style={{ ["--d" as string]: `${n.delay}s` }}
          />
        ))}
      </svg>
    </div>
  );
}
