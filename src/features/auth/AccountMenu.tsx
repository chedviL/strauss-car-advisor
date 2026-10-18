// src/features/auth/AccountMenu.tsx
// תפריט חשבון: המייל המחובר, קישור לבירורים/נציג (נציג רק למורשה), והחלפת חשבון/יציאה.
// "החלפת חשבון" ו"יציאה" מסיימות את הסשן בשרת ומנקות כל מצביע למשתמש הקודם.
import { signOut } from "../../app/auth-actions.js";

export function AccountMenu({ email, isStaff, showInquiriesLink = false }: { email: string | null; isStaff: boolean; showInquiriesLink?: boolean }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
      {email && (
        <bdi dir="ltr" style={{ color: "var(--color-muted)", fontSize: "var(--font-sm)" }} title="החשבון המחובר">{email}</bdi>
      )}
      {showInquiriesLink && <a className="btn btn-ghost" href="/inquiries" style={{ borderRadius: "var(--radius-pill)" }}>הבירורים שלי</a>}
      {isStaff && <a className="btn btn-ghost" href="/representative" style={{ borderRadius: "var(--radius-pill)" }}>אזור נציג</a>}
      <form action={signOut}>
        <button type="submit" className="btn" title="מסיים את הסשן ומנקה את הנתונים מהמסך">החלפת חשבון / יציאה</button>
      </form>
    </div>
  );
}