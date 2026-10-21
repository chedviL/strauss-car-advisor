// src/features/advisor/vehicle-match/DrawerNetwork.tsx
"use client";
// קישוט שוליים: רשת מופשטת עדינה, חוט אור אנכי וארבעה מוקדים (אחד לכל שאלה). דקורטיבי בלבד:
// aria-hidden, מחוץ לאזור הקריאה, בלי סמנטיקה של "חשיבה". נדלק מוקד אחד בכל אישור שלב,
// ובתוצאות ארבעת המוקדים מתחברים בקו אור. ההנפשה: transform/opacity בלבד.

const NODE_COLORS = ["var(--brand-orange)", "var(--brand-green)", "var(--brand-teal)", "var(--brand-orange)"];

export function DrawerNetwork({ lit, connected }: { lit: number; connected: boolean }) {
  return (
    <div className="vm-edge" aria-hidden="true">
      <i className="vm-deco-grid" />
      <i className="vm-thread" />
      <i className={`vm-thread-glow ${connected ? "is-on" : ""}`.trim()} />
      <i className="vm-pulse" />
      {NODE_COLORS.map((color, n) => (
        <span
          key={n}
          className={`vm-node ${n < lit ? "is-lit" : ""}`.trim()}
          style={{ ["--n" as string]: String(n), ["--c" as string]: color }}
        >
          <i />
        </span>
      ))}
      <i className="vm-sat vm-sat-1" />
      <i className="vm-sat vm-sat-2" />
      <i className="vm-sat vm-sat-3" />
    </div>
  );
}
