// src/features/advisor/DemoBadge.tsx
// סימון קבוע קטן "סביבת הדגמה" - תג צף ועדין בפינה התחתונה (סגנון משותף ב-globals.css).
export function DemoBadge({ sharedAccount = false }: { sharedAccount?: boolean }) {
  return (
    <span className="demo-badge" role="status" aria-label="סביבת הדגמה">
      {sharedAccount ? "חשבון הדגמה משותף · יש להשתמש בנתונים פיקטיביים בלבד" : "סביבת הדגמה"}
    </span>
  );
}
