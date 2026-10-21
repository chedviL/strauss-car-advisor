// src/features/brand/AppHeader.tsx
// כותרת עליונה משותפת לכל מסכי המוצר - אותה שפה כמו הכניסה (לוגו שטראוס + "יועץ
// הרכב"), ריווח ומצבי focus אחידים. רכיב שרת (ללא state); הפעולות מימין מוזרקות
// כ-children כדי לשמור גמישות לכל מסך.
import type { ReactNode } from "react";

export function AppHeader({ actions, leading }: { actions?: ReactNode; leading?: ReactNode }) {
  return (
    <header className="app-header">
      <div className="app-header-start">
        {leading}
        <a href="/" className="app-brand" aria-label="יועץ הרכב של שטראוס">
          <img src="/brand/strauss-logo.png" alt="שטראוס" />
          <span className="app-brand-sub">יועץ הרכב</span>
        </a>
      </div>
      {actions && <div className="app-header-actions">{actions}</div>}
    </header>
  );
}
