// src/features/auth/LoginForm.tsx
"use client";
// כניסה בשני שלבים: מייל -> קוד חד-פעמי. בלי סיסמה, בלי הרשמה נפרדת, בלי כניסת הדגמה.
//
// ⚠️ לוגיקת ההתחברות לא השתנתה: אותו OTP flow (requestOtp/verifyOtp), אותה שליחה
// חוזרת + cooldown, אותו טיפול בשגיאות ואותו redirect ל-/inquiries.
//
// שכבת אנימציה (feat/login-visual):
//  - קבוצות הופעה (login-entrance-group) לרצף פתיחה חד-פעמי.
//  - מצבי כפתור: ספינר + "שולחים קוד…"/"בודקים את הקוד…", סימן הצלחה.
//  - מעבר מייל<->קוד: החלפת אזור הטופס בלבד (crossfade), מיתוג/כותרת יציבים.
//  - calm בזמן מיקוד/הקלדה, busy בזמן בקשת שרת (דרך onCalm/onBusy).
//  - aria-live להודעות, aria-busy בזמן בקשה.
//
// הדמיה מקומית: עם ?sim=1 ה-OTP מדומה לוקאלית (בלי מייל אמיתי ובלי לעקוף אימות
// אמיתי) כדי לבדוק חזותית את כל המצבים. ברירת מחדל: הזרימה האמיתית.

import { useEffect, useState, useTransition, type CSSProperties } from "react";
import { requestOtp, verifyOtp } from "../../app/auth-actions.js";
import { CarVisual } from "./CarVisual.js";
import { OtpInput } from "./OtpInput.js";

// עוזר טיפוסים: CSS vars מותאמים (--enter-delay) אינם בטיפוס CSSProperties הסטנדרטי.
type CSSVars = CSSProperties & Record<`--${string}`, string>;

type Step = "email" | "code";
const RESEND_SECONDS = 60;

export function LoginForm({
  configured,
  onCalm,
  onBusy,
}: {
  configured: boolean;
  onCalm?: (calm: boolean) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();
  const [sim, setSim] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false); // ולידציה רכה אחרי blur
  const [slideBack, setSlideBack] = useState(false);       // כיוון מעבר הטופס

  // זיהוי מצב הדמיה מקומי (?sim=1) - ויזואלי בלבד, לא משנה הרשאות/אימות.
  useEffect(() => {
    try { setSim(new URLSearchParams(window.location.search).get("sim") === "1"); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    if (step !== "code") return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('[aria-label="ספרה 1 מתוך 8"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [step]);

  // busy = בזמן בקשת שרת. מדווח להורה (מגביר מעט פולסים באיור).
  useEffect(() => { onBusy?.(pending); }, [pending, onBusy]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // אורך הקוד: שטראוס/Supabase שולח 8 ספרות. נשמר כקבוע כדי לסנכרן תאים+ולידציה.
  const CODE_LEN = 8;
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const codeReady = code.replace(/\D/g, "").length >= CODE_LEN;
  // סטטוס תאי הקוד: הצלחה > שגיאה > רגיל. מניע את אנימציות התאים.
  const otpStatus: "idle" | "error" | "success" = success ? "success" : error && step === "code" ? "error" : "idle";

  // הדמיית בקשה מקומית: השהיה קצרה ותשובה קבועה, בלי רשת. "00000000" = קוד תקין.
  function simDelay<T>(value: T, ms = 700): Promise<T> {
    return new Promise((r) => setTimeout(() => r(value), ms));
  }

  function send(isResend: boolean) {
    setError(null); setInfo(null);
    startTransition(async () => {
      if (sim) {
        await simDelay(null);
        setSlideBack(false); setStep("code"); setCode(""); setCooldown(RESEND_SECONDS);
        setInfo(isResend ? "שלחנו קוד חדש. (הדמיה)" : "שלחנו קוד למייל. (הדמיה)");
        return;
      }
      const res = await requestOtp(email);
      if (res.status === "sent") {
        setSlideBack(false); setStep("code"); setCode(""); setCooldown(RESEND_SECONDS);
        setInfo(isResend ? "שלחנו קוד חדש." : "שלחנו קוד למייל. הוא תקף לזמן קצר.");
      } else if (res.status === "invalid_email") {
        setError("כתובת המייל אינה תקינה. בדוק ונסה שוב.");
      } else if (res.status === "rate_limited") {
        setCooldown(res.retryAfterSeconds);
        setError("נשלחו כמה קודים בזמן קצר. המתן מעט ונסה שוב.");
      } else {
        setError(res.message);
      }
    });
  }

  // codeArg: כשמגיע מ-onComplete של OtpInput, ה-state code עדיין לא עודכן (React
  // אסינכרוני), ולכן מעבירים את הקוד השלם ישירות כדי לא לאמת קוד ישן/חסר.
  function verify(codeArg?: string) {
    const codeToCheck = (codeArg ?? code).replace(/\D/g, "");
    setError(null); setInfo(null);
    startTransition(async () => {
      if (sim) {
        await simDelay(null);
        if (codeToCheck === "00000000") { setSuccess(true); await simDelay(null, 600); setInfo("התחברת! (הדמיה - אין ניווט)"); }
        else setError("הקוד שגוי או שפג תוקפו. אפשר לבקש קוד חדש.");
        return;
      }
      // בהצלחה השרת מפנה ל-/inquiries (redirect) ולכן לא חוזרים לכאן.
      const res = await verifyOtp(email, codeToCheck);
      if (!res) { setSuccess(true); return; } // הצלחה: לקראת redirect
      if (res.status === "invalid_code") setError("הקוד שגוי או שפג תוקפו. אפשר לבקש קוד חדש.");
      else if (res.status === "rate_limited") setError("יותר מדי ניסיונות. המתן כמה דקות ובקש קוד חדש.");
      else if (res.status === "unavailable") setError(res.message);
    });
  }

  function backToEmail() {
    // שומר את כתובת המייל שהוזנה; מחליף רק את אזור הטופס. slide הפוך (אחורה).
    setSlideBack(true); setStep("email"); setCode(""); setError(null); setInfo(null);
  }

  return (
    <>
      {/* מיתוג - קבוצת הופעה 1. יציב לאורך המעברים. */}
      <div className="login-brand login-entrance-group" style={{ "--enter-delay": "80ms" } as CSSVars}>
        <img src="/brand/strauss-logo.png" alt="שטראוס" />
        <span className="login-subbrand">יועץ הרכב</span>
      </div>

      {/* כותרות - קבוצת הופעה 2. יציבות לאורך המעברים. */}
      <div className="login-head login-entrance-group" style={{ "--enter-delay": "220ms" } as CSSVars}>
        <h1>
          <span className="login-title-a">הבחירה הבאה שלך</span>
          <span className="login-title-sep"> </span>
          <span className="login-title-b">מתחילה כאן.</span>
        </h1>
        <p>גלה איך בחירת הרכב תשפיע על הנטו שלך.</p>
      </div>

      {!configured ? (
        <div role="alert" style={{ color: "var(--color-danger)", fontSize: "var(--font-sm)" }}>
          ההתחברות עדיין לא הוגדרה בשרת. פנה למנהל המערכת.
        </div>
      ) : (
        // קבוצת הופעה 3 (שדות+כפתור). aria-busy בזמן בקשה.
        <form
          className="login-form login-entrance-group"
          style={{ "--enter-delay": "360ms" } as CSSVars}
          aria-busy={pending}
          onSubmit={(e) => { e.preventDefault(); if (step === "email") send(false); else verify(); }}
          noValidate
        >
          {/* מעטפת מעבר: מחליפה רק את אזור השלב (slide עדין), מעטפת יציבה. */}
          <div className={`login-form-swap ${slideBack ? "to-back" : ""}`.trim()}>
            <div key={step} className="login-form-step" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {step === "email" ? (
                <>
                  <div className={`field-float ${emailLooksValid ? "is-valid" : ""}`.trim()} dir="ltr">
                    <input
                      id="login-email"
                      type="email" inputMode="email" autoComplete="email" dir="ltr" required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onFocus={() => onCalm?.(true)}
                      onBlur={() => { onCalm?.(false); setEmailTouched(true); }}
                      placeholder=" "   /* רווח: מאפשר :placeholder-shown ל-floating label */
                      aria-invalid={emailTouched && email !== "" && !emailLooksValid}
                      aria-describedby={emailTouched && email !== "" && !emailLooksValid ? "email-err" : undefined}
                      style={{ textAlign: "start" }}
                    />
                    <label htmlFor="login-email" className="field-label">כתובת המייל שלך</label>
                    <span className="field-icon" aria-hidden="true">
                      {emailLooksValid ? <CheckGlyph small /> : <MailGlyph />}
                    </span>
                  </div>
                  {emailTouched && email !== "" && !emailLooksValid && (
                    <span id="email-err" className="field-hint-error" role="alert">כתובת המייל אינה תקינה.</span>
                  )}
                  <button type="submit" className="btn btn-graphite" disabled={pending || !emailLooksValid}>
                    {pending ? (
                      <><span className="btn-spinner" aria-hidden="true" /><span>שולח קוד…</span></>
                    ) : (
                      <><span>שלח לי קוד כניסה</span><ArrowGlyph /></>
                    )}
                  </button>
                </>
              ) : (
                <>
                  {/* באנר "שלחנו קוד למייל" - הודעת סטטוס רכה. */}
                  <div className="login-banner" role="status">
                    <MailGlyph />
                    <span>
                      שלחנו קוד אל{" "}
                      <bdi dir="ltr" style={{ fontWeight: 700 }}>{email.trim().toLowerCase()}</bdi>
                    </span>
                  </div>

                  <div style={{ fontSize: "var(--font-sm)", color: "var(--color-muted)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span id="code-label" style={{ fontWeight: 600, color: "var(--color-text)" }}>הזן את הקוד</span>
                    <button type="button" className="btn btn-ghost" onClick={backToEmail} disabled={pending} style={{ padding: "0 var(--space-2)" }}>
                      שינוי כתובת
                    </button>
                  </div>

                  <OtpInput
                    value={code}
                    onChange={(next) => { setCode(next); if (error) setError(null); }}
                    onComplete={(full) => { if (!pending && !success) verify(full); }}
                    length={CODE_LEN}
                    disabled={pending || success}
                    status={otpStatus}
                    autoFocus
                    onFocusCell={() => onCalm?.(true)}
                    onBlurCell={() => onCalm?.(false)}
                  />
                  <span id="code-hint" style={{ color: "var(--color-muted)", fontSize: "var(--font-sm)", textAlign: "center" }}>
                    אפשר להדביק את הקוד מהמייל.
                  </span>

                  <button type="submit" className="btn btn-graphite" disabled={pending || success || !codeReady}>
                    {success ? (
                      <><CheckGlyph /><span>נכנס…</span></>
                    ) : pending ? (
                      <><span className="btn-spinner" aria-hidden="true" /><span>בודק את הקוד…</span></>
                    ) : (
                      <span>כניסה</span>
                    )}
                  </button>

                  <button type="button" className="btn btn-ghost" onClick={() => send(true)} disabled={pending || cooldown > 0}>
                    <span className="resend-wrap">
                      {cooldown > 0 && <CooldownRing fraction={cooldown / RESEND_SECONDS} />}
                      {cooldown > 0 ? `שליחת קוד חדש בעוד ${cooldown} שנ׳` : "שליחת קוד חדש"}
                    </span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* הודעות מצב נגישות. */}
          <div aria-live="polite" style={{ minHeight: 20 }}>
            {error && <span role="alert" className="login-error" style={{ color: "var(--color-danger)", fontSize: "var(--font-sm)" }}>{error}</span>}
            {!error && info && <span style={{ color: "var(--color-muted)", fontSize: "var(--font-sm)" }}>{info}</span>}
          </div>
        </form>
      )}

      {/* איור הרכב בנייד בלבד: מתחת לכפתור, מעל הערת ההדגמה. מוסתר במחשב ב-CSS. */}
      <div className="login-visual-inline">
        <CarVisual mode="mobile" />
      </div>

      {/* תג "סביבת הדגמה" צף בפינה (כמו במסך הראשי), במקום הערת שוליים. */}
      <span className="demo-badge demo-badge-login" role="status" aria-label="סביבת הדגמה">
        סביבת הדגמה
      </span>
    </>
  );
}

// חץ כניסה בכפתור. ב-RTL מצביע שמאלה (קדימה) בדומה לרפרנס.
function ArrowGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flex: "0 0 auto" }}>
      <path d="M19 12H5M5 12l6-6M5 12l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// סימן אישור הצלחה. small=אייקון תקינות בשדה (צבע ירוק), אחרת בכפתור (לבן).
function CheckGlyph({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={small ? undefined : "btn-check"}
      width={small ? 18 : undefined} height={small ? 18 : undefined}
      viewBox="0 0 24 24" fill="none" aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" stroke={small ? "currentColor" : "#fff"} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// אייקון מעטפה.
function MailGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// טבעת התקדמות ל-cooldown: מתרוקנת עם השניות (fraction 1->0).
function CooldownRing({ fraction }: { fraction: number }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(1, fraction)));
  return (
    <svg className="resend-ring" viewBox="0 0 18 18" aria-hidden="true">
      <circle className="track" cx="9" cy="9" r={r} />
      <circle className="prog" cx="9" cy="9" r={r} strokeDasharray={c} strokeDashoffset={offset} />
    </svg>
  );
}
