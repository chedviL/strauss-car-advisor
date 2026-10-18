// src/app/login/page.tsx
// מסך כניסה: מייל -> קוד חד-פעמי -> היועץ. ללא סיסמה, ללא הרשמה נפרדת, ללא כניסת הדגמה.
import { LoginForm } from "../../features/auth/LoginForm.js";
import { authConfigured } from "../../server/auth/supabase.js";

export default function LoginPage() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-4)" }}>
      <div className="card anim-card" style={{ width: "min(420px, 100%)", padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <header style={{ textAlign: "center" }}>
          <div style={{ color: "var(--color-muted)", fontSize: "var(--font-sm)", letterSpacing: "0.04em", marginBottom: "var(--space-2)" }}>
            שטראוס · יועץ הרכב האישי
          </div>
          <h1 style={{ fontSize: "var(--font-xl)" }}>כניסה</h1>
          <p style={{ color: "var(--color-muted)", marginTop: "var(--space-2)" }}>
            הכניסה בקוד חד-פעמי שנשלח למייל.
          </p>
        </header>
        <LoginForm configured={authConfigured()} />
      </div>
    </main>
  );
}