"use client";

// src/app/prototype/CarConstellation.tsx
// רשת אינטליגנציה מופשטת בצורת דמוי-רכב.
// לא מצייר רכב בקווי מתאר - בונה נפח מנקודות וקשרים דקים שהסידור הכולל שלהם
// מרמז על רכב: קשת עליונה (גג) + שתי התכנסויות מעגליות (גלגלים), עם אזורים
// פתוחים ונקודות בודדות מחוץ למבנה. המראה: אינטליגנציה, עומק ודיוק.
//
// אין קריאות מודל ואין רשת - רכיב חזותי טהור, עם נתוני צמתים דטרמיניסטיים.
//
// תנועה = פולסים של אור לאורך הרשת (לא תזוזה בלתי פוסקת של כל הנקודות):
//   rest       - נשימה עדינה בלבד, הרשת שקטה
//   processing - פולסי אור רצים לאורך הקשרים
//   result     - הפולסים נרגעים, זוהר רך מתכנס
//   error      - גוון אזהרה מאופק, פעימה בודדת ואיטית

import { useId, useMemo, type CSSProperties } from "react";

export type CarMotionState = "rest" | "processing" | "result" | "error";

// עזר מוקלד להעברת משתני-CSS מותאמים (--name) כ-style תקין.
function cssVars(vars: Record<`--${string}`, string | number>): CSSProperties {
  return vars as CSSProperties;
}

type Node = {
  id: string;
  x: number;
  y: number;
  r: number;
  w: number; // משקל/בהירות (0..1) - צמתים חזקים יוצרים את ה"עומק"
  outlier?: boolean;
};
type Edge = { a: string; b: string; strong?: boolean };

// ---------------------------------------------------------------------------
// בניית הרשת על רשת (grid) 1000x460. הכל דטרמיניסטי (PRNG עם seed קבוע)
// כדי שלא יתקבל "ענן אקראי" שונה בכל רינדור.
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Built = { nodes: Node[]; edges: Edge[]; wheels: { cx: number; cy: number; r: number }[]; roof: string };

function buildMesh(): Built {
  const rnd = mulberry32(73);
  const nodes: Node[] = [];

  const WHEEL_F = { cx: 318, cy: 322, r: 78 };
  const WHEEL_R = { cx: 690, cy: 322, r: 78 };

  // גבול עליון של מסת הגוף: קשת גג רכה מעל תא הנוסעים, יורדת לכיוון האף והזנב.
  // מחזיר y עליון לפי x (ככל שהערך נמוך יותר, הגבול גבוה יותר על המסך).
  const topBoundary = (x: number): number => {
    // קשת גג מרכזית סביב x=500
    const roof = 150 + 120 * Math.pow(Math.abs(x - 505) / 505, 1.7);
    // מכסה מנוע וזנב נמוכים יותר (קו חגורה)
    const belt = 250;
    return Math.min(belt, roof);
  };
  const bottomBoundary = 330; // קו תחתית הגוף (sill)

  // האם נקודה נמצאת בתוך "מסת הגוף" (האזור שבין הגבול העליון לתחתית, בין האף לזנב)
  const inBody = (x: number, y: number): boolean => {
    if (x < 150 || x > 858) return false;
    if (y < topBoundary(x) || y > bottomBoundary) return false;
    return true;
  };
  // קרבה למעגל גלגל (טבעת צרה) - כדי ליצור "התכנסות מעגלית"
  const nearWheel = (x: number, y: number, w: { cx: number; cy: number; r: number }): boolean => {
    const d = Math.hypot(x - w.cx, y - w.cy);
    return d > w.r * 0.55 && d < w.r * 1.08;
  };

  // 1) צמתים על טבעות הגלגלים (ההתכנסויות המעגליות) - צפופים ובהירים.
  for (const w of [WHEEL_F, WHEEL_R]) {
    const count = 11;
    for (let i = 0; i < count; i++) {
      const ang = Math.PI + (Math.PI * i) / (count - 1) + (rnd() - 0.5) * 0.12; // חצי עליון בעיקר
      const rr = w.r * (0.82 + rnd() * 0.22);
      const x = w.cx + Math.cos(ang) * rr;
      const y = w.cy + Math.sin(ang) * rr;
      if (y > bottomBoundary + 6) continue;
      nodes.push({ id: `w-${w.cx}-${i}`, x, y, r: 3 + rnd() * 1.6, w: 0.7 + rnd() * 0.3 });
    }
    // כמה צמתים פנימיים (רכזת) לציון מרכז הגלגל
    nodes.push({ id: `wc-${w.cx}`, x: w.cx, y: w.cy - 10, r: 2.4, w: 0.45 });
  }

  // 2) צמתים על קשת הגג (הגבול העליון) - מדגישים את הקשת העליונה.
  const roofPts: { x: number; y: number }[] = [];
  for (let i = 0; i <= 10; i++) {
    const x = 330 + (i / 10) * 360; // תא הנוסעים בערך
    const y = topBoundary(x) + (rnd() - 0.5) * 6;
    nodes.push({ id: `roof-${i}`, x, y, r: 3 + rnd() * 1.4, w: 0.65 + rnd() * 0.3 });
    roofPts.push({ x, y });
  }
  const roof =
    "M " + roofPts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L ");

  // 3) מילוי מסת הגוף בנקודות פנימיות - יוצר נפח ועומק, עם אזורים פתוחים.
  //    דוגמים על רשת רופפת ומשמיטים חלק מהתאים כדי להשאיר "חללים".
  for (let gx = 160; gx <= 850; gx += 46) {
    for (let gy = 150; gy <= 330; gy += 40) {
      const jx = gx + (rnd() - 0.5) * 30;
      const jy = gy + (rnd() - 0.5) * 28;
      if (!inBody(jx, jy)) continue;
      // השאר אזורים פתוחים: הסתברות השמטה גבוהה יותר במרכז-תחתון
      const openBias = 0.28 + 0.22 * (jy > 250 ? 1 : 0);
      if (rnd() < openBias) continue;
      const strong = jy < 215 || nearWheel(jx, jy, WHEEL_F) || nearWheel(jx, jy, WHEEL_R);
      nodes.push({
        id: `b-${gx}-${gy}`,
        x: jx,
        y: jy,
        r: 2.2 + rnd() * (strong ? 2.2 : 1.4),
        w: strong ? 0.55 + rnd() * 0.35 : 0.28 + rnd() * 0.25,
      });
    }
  }

  // 4) נקודות בודדות מחוץ למבנה - "אינטליגנציה" שמתפשטת מעבר לגוף.
  const outliers: [number, number][] = [
    [96, 196], [120, 150], [150, 110], [880, 180], [910, 232], [500, 86],
    [60, 300], [945, 300], [250, 92], [760, 96],
  ];
  outliers.forEach(([x, y], i) => {
    nodes.push({ id: `o-${i}`, x: x + (rnd() - 0.5) * 14, y: y + (rnd() - 0.5) * 14, r: 2 + rnd() * 1.4, w: 0.3 + rnd() * 0.25, outlier: true });
  });

  // ---------------------------------------------------------------------------
  // קשרים: חבר כל צומת לשכנים הקרובים (k-NN קצר). קשרים דקים בלבד.
  // מגבילים אורך כדי לא "לצייר" קווי מתאר ארוכים, ומשאירים חללים פתוחים.
  // ---------------------------------------------------------------------------
  const edges: Edge[] = [];
  const seen = new Set<string>();
  const MAX = 86; // אורך קשר מרבי
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (!a) continue;
    const dists: { j: number; d: number }[] = [];
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const bj = nodes[j];
      if (!bj) continue;
      const d = Math.hypot(a.x - bj.x, a.y - bj.y);
      if (d <= MAX) dists.push({ j, d });
    }
    dists.sort((p, q) => p.d - q.d);
    const k = a.outlier ? 1 : 2 + Math.floor(rnd() * 2); // outliers מתחברים בקושי
    for (let t = 0; t < Math.min(k, dists.length); t++) {
      const entry = dists[t];
      if (!entry) continue;
      const b = nodes[entry.j];
      if (!b) continue;
      const key = i < entry.j ? `${i}-${entry.j}` : `${entry.j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const strong = a.w > 0.6 && b.w > 0.6 && entry.d < 60;
      edges.push({ a: a.id, b: b.id, strong });
    }
  }

  return { nodes, edges, wheels: [WHEEL_F, WHEEL_R], roof };
}

export function CarConstellation({
  state = "rest",
  variant = "hero",
  reducedMotion = false,
  title = "רשת אינטליגנציה בצורת רכב",
}: {
  state?: CarMotionState;
  variant?: "hero" | "margin";
  reducedMotion?: boolean;
  title?: string;
}) {
  const uid = useId().replace(/[:]/g, "");
  const glowId = `glow-${uid}`;
  const dataState = reducedMotion ? "rest" : state;

  const { nodes, edges, wheels, roof } = useMemo(() => buildMesh(), []);
  const nodeMap = useMemo(() => {
    const m = new Map<string, Node>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  // בחירת תת-קבוצה של קשרים ש"יוארו" בפולס (לא כולם, כדי לשמור על עומק).
  const pulseEdges = useMemo(
    () => edges.map((e, i) => ({ e, i })).filter(({ i }) => i % 3 === 0),
    [edges],
  );

  return (
    <svg
      className={`car-svg car-svg--${variant}`}
      data-state={dataState}
      viewBox="0 0 1000 460"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="7" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id={`rg-${uid}`} cx="50%" cy="46%" r="60%">
          <stop offset="0%" stopColor="var(--c-accent)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--c-accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* זוהר מתכנס במצב "תוצאה" */}
      <ellipse className="car-aura" cx="505" cy="250" rx="360" ry="150" fill={`url(#rg-${uid})`} aria-hidden="true" />

      {/* רמז עדין לקשת העליונה (הגג) - קו דק מאוד, לא קו מתאר מלא */}
      <path className="car-roof-hint" d={roof} fill="none" aria-hidden="true" />

      {/* התכנסויות מעגליות (גלגלים) - טבעת דקה מאוד שמחזקת את הרמז */}
      <g className="car-wheels" aria-hidden="true">
        {wheels.map((w, i) => (
          <circle key={`wh-${i}`} cx={w.cx} cy={w.cy} r={w.r} />
        ))}
      </g>

      {/* קשרים דקים */}
      <g className="car-edges">
        {edges.map((e, i) => {
          const na = nodeMap.get(e.a)!;
          const nb = nodeMap.get(e.b)!;
          return (
            <line
              key={`e-${i}`}
              x1={na.x}
              y1={na.y}
              x2={nb.x}
              y2={nb.y}
              className={e.strong ? "edge edge--strong" : "edge"}
            />
          );
        })}
      </g>

      {/* פולסי אור הרצים לאורך תת-קבוצת קשרים (מצב "עיבוד") */}
      <g className="car-pulses" aria-hidden="true">
        {pulseEdges.map(({ e, i }) => {
          const na = nodeMap.get(e.a)!;
          const nb = nodeMap.get(e.b)!;
          const begin = `${(i * 90) % 2000}ms`;
          return (
            <circle key={`p-${i}`} r={3.2} className="car-pulse">
              <animate
                attributeName="cx"
                values={`${na.x};${nb.x}`}
                dur="2s"
                begin={begin}
                repeatCount="indefinite"
                calcMode="spline"
                keySplines="0.4 0 0.2 1"
              />
              <animate
                attributeName="cy"
                values={`${na.y};${nb.y}`}
                dur="2s"
                begin={begin}
                repeatCount="indefinite"
                calcMode="spline"
                keySplines="0.4 0 0.2 1"
              />
            </circle>
          );
        })}
      </g>

      {/* צמתים (נקודות) - גודל/בהירות לפי משקל => עומק */}
      <g className="car-nodes">
        {nodes.map((n) => (
          <circle
            key={n.id}
            cx={n.x}
            cy={n.y}
            r={n.r}
            className={`node${n.outlier ? " node--outlier" : ""}`}
            style={cssVars({
              "--w": n.w.toFixed(2),
              "--d": `${Math.round((n.x + n.y) % 1600)}ms`,
            })}
          />
        ))}
      </g>
    </svg>
  );
}
