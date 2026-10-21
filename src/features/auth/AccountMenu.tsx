// src/features/auth/AccountMenu.tsx
// תפריט חשבון בכותרת, אחיד בכל המסכים: המייל המחובר, "אזור עובד", "אזור נציג" והחלפת חשבון/יציאה.
// שלושת הכפתורים באותו גודל וסגנון; האזור הנוכחי מסומן (aria-current) ומלא, כך שתמיד יש דרך
// לעבור בין העובד לנציג. "אזור נציג" מוצג לכל משתמש מחובר: נציג מורשה נכנס ישירות, ואחרים רואים
// הסבר ואפשרות התנסות (כשהיא פעילה בשרת). ההרשאה האמיתית נקבעת בשרת ולא בתפריט.
// "החלפת חשבון" ו"יציאה" מסיימות את הסשן בשרת ומנקות כל מצביע למשתמש הקודם.
import type { CSSProperties } from "react";
import { signOut } from "../../app/auth-actions.js";

// סגנון משותף לכל הכפתורים בכותרת (אותו padding, גודל גופן ורדיוס).
const navBtn: CSSProperties = {
  padding: "6px 16px",
  fontSize: "var(--font-sm)",
  lineHeight: 1.4,
  whiteSpace: "nowrap",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};
const currentBtn: CSSProperties = {
  ...navBtn,
  background: "var(--color-graphite)",
  borderColor: "var(--color-graphite)",
  color: "#fff",
};

export function AccountMenu({ email, area = "employee" }: { email: string | null; area?: "employee" | "rep" }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
      {email && (
        <bdi dir="ltr" style={{ color: "var(--color-muted)", fontSize: "var(--font-sm)" }} title="החשבון המחובר">{email}</bdi>
      )}
      <a
        className="btn" href="/" style={area === "employee" ? currentBtn : navBtn}
        aria-current={area === "employee" ? "page" : undefined}
      >
        אזור עובד
      </a>
      <a
        className="btn" href="/representative" style={area === "rep" ? currentBtn : navBtn}
        aria-current={area === "rep" ? "page" : undefined}
      >
        אזור נציג
      </a>
      <form action={signOut}>
        <button type="submit" className="btn" style={navBtn} title="מסיים את הסשן ומנקה את הנתונים מהמסך">החלפת חשבון / יציאה</button>
      </form>
    </div>
  );
}
