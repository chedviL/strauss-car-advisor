// src/features/auth/AccountMenu.tsx
// תפריט חשבון בכותרת, אחיד בכל המסכים: "אזור עובד", "אזור נציג" והחלפת חשבון/יציאה (ללא כתובת מייל).
// שלושת הכפתורים באותו גודל וסגנון; האזור הנוכחי מסומן (aria-current) ברקע רך, כך שתמיד יש דרך
// לעבור בין העובד לנציג. "אזור נציג" מוצג לכל משתמש מחובר: נציג מורשה נכנס ישירות, ואחרים רואים
// הסבר ואפשרות התנסות (כשהיא פעילה בשרת). ההרשאה האמיתית נקבעת בשרת ולא בתפריט.
// "החלפת חשבון" ו"יציאה" מסיימות את הסשן בשרת ומנקות כל מצביע למשתמש הקודם.
// הסגנון מוגדר במחלקות CSS (nav-btn / is-current) ולא ב-inline, כדי שה-media
// queries בנייד יוכלו לכווץ ריווח ולאפשר גלישת טקסט (מניעת גלילה אופקית).
import { SignOutForm } from "./SignOutForm.js";

// email נשמר בחתימה לתאימות עם הקוראים הקיימים, אך אינו מוצג עוד בכותרת.
export function AccountMenu({ area = "employee" }: { email?: string | null; area?: "employee" | "rep" }) {
  return (
    <nav className="account-menu" aria-label="מעבר בין אזורים">
      <a
        className={`btn nav-btn${area === "employee" ? " is-current" : ""}`} href="/"
        aria-current={area === "employee" ? "page" : undefined}
      >
        אזור עובד
      </a>
      <a
        className={`btn nav-btn${area === "rep" ? " is-current" : ""}`} href="/representative"
        aria-current={area === "rep" ? "page" : undefined}
      >
        אזור נציג
      </a>
      <SignOutForm />
    </nav>
  );
}
