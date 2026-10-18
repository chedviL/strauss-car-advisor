// src/features/auth/LoginForm.tsx
"use client";
// כניסה בשני שלבים: מייל -> קוד חד-פעמי. בלי סיסמה, בלי הרשמה נפרדת, בלי כניסת הדגמה.
// מתאים למחלקות העיצוב הקיימות; ללא מאפיינים חדשים.

import { useEffect, useRef, useState, useTransition } from "react";
import { requestOtp, verifyOtp } from "../../app/auth-actions.js";

type Step = "email" | "code";
const RESEND_SECONDS = 60;

export function LoginForm({ configured }: { configured: boolean }) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [pending, startTransition] = useTransition();
  const codeRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => { if (step === "code") codeRef.current?.focus(); }, [step]);

  function send(isResend: boolean) {
    setError(null); setInfo(null);
    startTransition(async () => {
      const res = await requestOtp(email);
      if (res.status === "sent") {
        setStep("code"); setCode(""); setCooldown(RESEND_SECONDS);
        setInfo(isResend ? "שלחנו קוד חדש." : "שלחנו קוד למייל. הוא תקף לזמן קצר.");
      } else if (res.status === "invalid_email") {
        setError("כתובת המייל אינה תקינה. בדקו ונסו שוב.");
      } else if (res.status === "rate_limited") {
        setCooldown(res.retryAfterSeconds);
        setError("נשלחו כמה קודים בזמן קצר. המתינו מעט ונסו שוב.");
      } else {
        setError(res.message);
      }
    });
  }

  function verify() {
    setError(null); setInfo(null);
    startTransition(async () => {
      // בהצלחה השרת מפנה ל-/inquiries (redirect), ולכן לא חוזרים לכאן.
      const res = await verifyOtp(email, code);
      if (!res) return;
      if (res.status === "invalid_code") setError("הקוד שגוי או שפג תוקפו. אפשר לבקש קוד חדש.");
      else if (res.status === "rate_limited") setError("יותר מדי ניסיונות. המתינו כמה דקות ובקשו קוד חדש.");
      else if (res.status === "unavailable") setError(res.message);
    });
  }

  function backToEmail() {
    setStep("email"); setCode(""); setError(null); setInfo(null);
  }

  if (!configured) {
    return (
      <div role="alert" style={{ color: "var(--color-danger)", fontSize: "var(--font-sm)" }}>
        ההתחברות עדיין לא הוגדרה בשרת. פנו למנהל המערכת.
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (step === "email") send(false); else verify(); }}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
      noValidate
    >
      {step === "email" ? (
        <>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontWeight: 600 }}>כתובת מייל</span>
            <input
              type="email" inputMode="email" autoComplete="email" dir="ltr" required
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com" aria-describedby="login-hint"
              style={{ textAlign: "start" }}
            />
          </label>
          <span id="login-hint" style={{ color: "var(--color-muted)", fontSize: "var(--font-sm)" }}>
            נשלח אליכם קוד חד-פעמי. אין צורך בסיסמה או בהרשמה נפרדת.
          </span>
          <button type="submit" className="btn btn-primary" disabled={pending || email.trim() === ""}>
            {pending ? "שולח…" : "שליחת קוד"}
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: "var(--font-sm)", color: "var(--color-muted)" }}>
            הקוד נשלח אל <bdi dir="ltr" style={{ color: "var(--color-text)", fontWeight: 600 }}>{email.trim().toLowerCase()}</bdi>
            {" "}<button type="button" className="btn btn-ghost" onClick={backToEmail} style={{ padding: "0 var(--space-2)" }}>שינוי כתובת</button>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontWeight: 600 }}>קוד כניסה</span>
            <input
              ref={codeRef} type="text" inputMode="numeric" autoComplete="one-time-code" dir="ltr"
              pattern="[0-9 -]*" maxLength={14}
              value={code} onChange={(e) => setCode(e.target.value)}
              placeholder="000000" aria-describedby="code-hint"
              style={{ textAlign: "start", letterSpacing: "0.2em", fontSize: "var(--font-lg)" }}
            />
          </label>
          <span id="code-hint" style={{ color: "var(--color-muted)", fontSize: "var(--font-sm)" }}>
            אפשר להדביק את הקוד מהמייל.
          </span>
          <button type="submit" className="btn btn-primary" disabled={pending || code.replace(/\D/g, "").length < 6}>
            {pending ? "מאמת…" : "כניסה"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => send(true)} disabled={pending || cooldown > 0}>
            {cooldown > 0 ? `שליחת קוד חדש בעוד ${cooldown} שנ׳` : "שליחת קוד חדש"}
          </button>
        </>
      )}
      <div aria-live="polite" style={{ minHeight: 20 }}>
        {error && <span role="alert" style={{ color: "var(--color-danger)", fontSize: "var(--font-sm)" }}>{error}</span>}
        {!error && info && <span style={{ color: "var(--color-muted)", fontSize: "var(--font-sm)" }}>{info}</span>}
      </div>
    </form>
  );
}