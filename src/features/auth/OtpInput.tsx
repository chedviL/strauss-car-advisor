// src/features/auth/OtpInput.tsx
"use client";
// קלט קוד חד-פעמי ב-6 תאים נפרדים, בסגנון העיצוב (פנינה/גרפיט).
// חוויית OTP מיטבית:
//  - auto-advance: הקלדת ספרה מקדמת לתא הבא; Backspace חוזר אחורה.
//  - הדבקה: הדבקת קוד שלם (גם "123 456" / "123-456") ממלאת את כל התאים.
//  - חיצים: ניווט בין תאים; Home/End לקצוות.
//  - מילוי אוטומטי: תא ראשון נושא autocomplete="one-time-code" (SMS/מייל).
//  - פופ עדין בכל ספרה; מצבי success/error על כל השורה.
// נגישות: role=group עם aria-label, inputMode=numeric, תוויות לכל תא.
//
// הקומפוננטה "נשלטת": מקבלת value (מחרוזת ספרות עד 6) ו-onChange. הלוגיקה
// העסקית (אימות/שליחה) נשארת ב-LoginForm; כאן קלט בלבד.

import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";

export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 8,
  disabled = false,
  status = "idle",
  autoFocus = false,
  onFocusCell,
  onBlurCell,
}: {
  value: string;                       // ספרות בלבד, עד length
  onChange: (next: string) => void;
  onComplete?: (code: string) => void; // נקרא כשמגיעים ל-length ספרות
  length?: number;                     // אורך הקוד (ברירת מחדל 8)
  disabled?: boolean;
  status?: "idle" | "error" | "success";
  autoFocus?: boolean;
  onFocusCell?: () => void;            // לתיאום calm באיור
  onBlurCell?: () => void;
}) {
  const LEN = length;
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.replace(/\D/g, "").slice(0, LEN).split("");
  const cells = Array.from({ length: LEN }, (_, i) => digits[i] ?? "");

  function focusCell(i: number) {
    const el = refs.current[Math.max(0, Math.min(LEN - 1, i))];
    el?.focus();
    el?.select();
  }

  function setAt(i: number, digit: string) {
    const arr = cells.slice();
    arr[i] = digit;
    const next = arr.join("").replace(/\D/g, "").slice(0, LEN);
    onChange(next);
    if (next.length === LEN) onComplete?.(next);
  }

  function handleChange(i: number, raw: string) {
    const only = raw.replace(/\D/g, "");
    if (only === "") { setAt(i, ""); return; }
    // אם הודבקו/הוקלדו כמה ספרות בתא אחד - פורסים קדימה.
    if (only.length > 1) {
      const arr = cells.slice();
      let p = i;
      for (const ch of only) { if (p >= LEN) break; arr[p] = ch; p++; }
      const next = arr.join("").replace(/\D/g, "").slice(0, LEN);
      onChange(next);
      focusCell(Math.min(p, LEN - 1));
      if (next.length === LEN) onComplete?.(next);
      return;
    }
    setAt(i, only);
    if (i < LEN - 1) focusCell(i + 1);
  }

  function handleKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      if (cells[i]) { setAt(i, ""); return; }
      if (i > 0) { e.preventDefault(); focusCell(i - 1); setAt(i - 1, ""); }
    } else if (e.key === "ArrowLeft") {
      // RTL: שמאל = קדימה ויזואלית, אך נשאר ניווט טבעי בין תאים.
      e.preventDefault(); focusCell(i + 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault(); focusCell(i - 1);
    } else if (e.key === "Home") {
      e.preventDefault(); focusCell(0);
    } else if (e.key === "End") {
      e.preventDefault(); focusCell(LEN - 1);
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LEN);
    if (!pasted) return;
    onChange(pasted);
    focusCell(Math.min(pasted.length, LEN - 1));
    if (pasted.length === LEN) onComplete?.(pasted);
  }

  return (
    <div
      className={`otp ${status !== "idle" ? `otp-${status}` : ""}`.trim()}
      role="group"
      aria-label={`קוד כניסה בן ${LEN} ספרות`}
      dir="ltr"
    >
      {cells.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          className={`otp-cell ${d ? "is-filled" : ""}`.trim()}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          autoComplete={i === 0 ? "one-time-code" : "off"}
          value={d}
          disabled={disabled}
          aria-label={`ספרה ${i + 1} מתוך ${LEN}`}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => { e.currentTarget.select(); onFocusCell?.(); }}
          onBlur={() => onBlurCell?.()}
        />
      ))}
    </div>
  );
}
