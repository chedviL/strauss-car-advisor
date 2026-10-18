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
        borderRadius: "var(--radius-pill)",
        padding: "3px 12px",
        fontSize: "var(--font-sm)",
        color: "var(--color-muted)",
        boxShadow: "var(--shadow-sm)",
        opacity: 0.9,
      }}
    >
      סביבת הדגמה
    </div>
  );
}