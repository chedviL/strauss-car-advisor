// src/features/advisor/DemoBadge.tsx
// סימון קבוע קטן "סביבת הדגמה" - פעם אחת, לא בכל כפתור.
export function DemoBadge() {
  return (
    <div
      role="status"
      aria-label="סביבת הדגמה"
      style={{
        position: "fixed",
        bottom: "var(--space-3)",
        insetInlineStart: "var(--space-3)",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        padding: "2px 10px",
        fontSize: "0.8rem",
        color: "var(--color-muted)",
        boxShadow: "var(--shadow)",
      }}
    >
      סביבת הדגמה
    </div>
  );
}