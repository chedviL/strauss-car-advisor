// src/features/advisor/VoiceInput.tsx
"use client";
// "דבר איתי": קלט דיבור לקומפוזר. לוחצים, מדברים, לוחצים "סיימתי" - והדברים
// נכנסים לתיבת הטקסט *לעריכה ואישור*, ולא נשלחים אוטומטית. אותו עקרון כמו
// חילוץ התלוש: המודל מציע, המשתמש/ת מאשר/ת.
//
// ההתנסות מנוסחת כשיחה ולא כמכשיר הקלטה: אין "מקליט/הקלטה/תמלול" בממשק,
// והחיווי הוא האזנה (גלי קול מקפצים) ולא נקודה אדומה.
//
// פרטיות: המיקרופון נפתח רק בזמן שהכפתור לחוץ ונסגר מיד בסיום. הקול נשלח
// לזיהוי בשרת ואינו נשמר בשום מקום.
// נגישות: aria-label/aria-pressed על הכפתור, חיווי מצב ב-role="status",
// המצב מסומן גם בטקסט ובצורה (לא בצבע בלבד), והאנימציה מכובדת תחת
// prefers-reduced-motion (ראו globals.css).

import { useEffect, useRef, useState } from "react";

type Phase = "idle" | "listening" | "thinking" | "error";

/** תקרת זמן דיבור רצוף - שומרת על קבצים קטנים ועל המכסה. */
const MAX_LISTEN_MS = 60_000;

export function VoiceInput({
  onTranscript,
  disabled = false,
}: {
  /** נקרא עם הטקסט שזוהה; המקבל מחליט מה לעשות (אצלנו: למלא את תיבת הטקסט). */
  onTranscript: (text: string) => void;
  disabled?: boolean;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // מונע עדכון state אחרי unmount (ההאזנה והזיהוי הם אסינכרוניים).
  const aliveRef = useRef(true);
  // true בזמן ההמתנה לאישור הרשאת המיקרופון (מונע התחלה כפולה).
  const startingRef = useRef(false);

  // זמינות התכונה נקבעת בשרת (קיים מפתח ספק). אם לא - הכפתור לא מוצג בכלל,
  // כדי לא להציע יכולת שאינה קיימת.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/transcribe")
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d: { available?: boolean }) => { if (!cancelled) setAvailable(d.available === true); })
      .catch(() => { if (!cancelled) setAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  // ניקוי: סגירת המיקרופון ביציאה מהמסך.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        try { rec.stop(); } catch { /* כבר נעצר */ }
      }
      rec?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function releaseStream() {
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
  }

  async function sendForRecognition(blob: Blob) {
    if (!aliveRef.current) return;
    setPhase("thinking");
    setMsg("רגע, מבין…");
    try {
      const fd = new FormData();
      fd.append("audio", blob, "speech.webm");
      const res = await fetch("/api/transcribe", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!aliveRef.current) return;
      if (!res.ok || !data.text) {
        setPhase("error");
        setMsg(data.error ?? "לא הצלחתי להבין. אפשר לנסות שוב או להקליד.");
        return;
      }
      setPhase("idle");
      setMsg("");
      onTranscript(data.text);
    } catch {
      if (!aliveRef.current) return;
      setPhase("error");
      setMsg("שגיאת רשת. אפשר לנסות שוב או להקליד.");
    }
  }

  async function startListening() {
    setMsg("");
    // בדיקת תמיכה: דפדפן ללא MediaRecorder/getUserMedia (או הקשר לא מאובטח).
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setPhase("error");
      setMsg("הדפדפן אינו תומך בדיבור. אפשר להקליד.");
      return;
    }
    // מניעת התחלה כפולה בזמן שחלון ההרשאה פתוח (שתי הקלטות = זרם יתום שלא נעצר לעולם).
    if (startingRef.current || recorderRef.current) return;
    startingRef.current = true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      startingRef.current = false;
      setPhase("error");
      // הבחנה בין סירוב הרשאה לבין היעדר מיקרופון - הודעות שונות ומועילות.
      const name = (e as { name?: string })?.name ?? "";
      setMsg(
        name === "NotAllowedError" || name === "SecurityError"
          ? "הגישה למיקרופון נדחתה. אפשר לאשר בהגדרות הדפדפן, או להקליד."
          : "לא נמצא מיקרופון זמין. אפשר להקליד.",
      );
      return;
    }

    startingRef.current = false;
    // הרכיב הוסר בזמן שחלון ההרשאה היה פתוח: משחררים את המיקרופון מיד ולא מקליטים.
    if (!aliveRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    // בוחרים פורמט שהדפדפן תומך בו ושהשרת מקבל.
    const preferred = ["audio/webm", "audio/ogg", "audio/mp4"];
    const mimeType = preferred.find((t) => MediaRecorder.isTypeSupported?.(t));
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setPhase("error");
      setMsg("אי אפשר להשתמש בדיבור בדפדפן הזה. אפשר להקליד.");
      return;
    }

    chunksRef.current = [];
    recorderRef.current = rec;
    rec.ondataavailable = (ev) => { if (ev.data.size > 0) chunksRef.current.push(ev.data); };
    rec.onstop = () => {
      if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
      const type = rec.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      releaseStream();
      if (blob.size === 0) {
        setPhase("error");
        setMsg("לא שמעתי כלום. נסה שוב.");
        return;
      }
      void sendForRecognition(blob);
    };

    rec.start();
    setPhase("listening");
    setMsg("מקשיב… לחיצה נוספת לסיום");
    // עצירה אוטומטית בתקרת הזמן, כדי לא ליצור קבצים גדולים.
    stopTimerRef.current = setTimeout(() => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    }, MAX_LISTEN_MS);
  }

  function stopListening() {
    const rec = recorderRef.current;
    if (rec && rec.state === "recording") rec.stop();
  }

  function toggle() {
    if (phase === "listening") stopListening();
    else if (phase === "idle" || phase === "error") void startListening();
  }

  // התכונה אינה מוגדרת בסביבה - לא מציגים כפתור כלל.
  if (available !== true) return null;

  const listening = phase === "listening";
  const thinking = phase === "thinking";
  // שם נגיש קבוע לפי מצב. את הטקסט הנראה "דבר איתי" מציגה בועה במעבר עכבר/מיקוד.
  const accessibleName = listening ? "סיימתי לדבר" : thinking ? "מבין את מה שנאמר" : "דבר איתי";

  return (
    <>
      <button
        type="button"
        className={`icon-btn has-tip voice-btn ${listening ? "is-listening" : ""} ${thinking ? "is-busy" : ""}`.replace(/\s+/g, " ").trim()}
        aria-label={accessibleName}
        aria-pressed={listening}
        disabled={disabled || thinking}
        onClick={toggle}
      >
        {thinking ? <SpinnerIcon /> : <VoiceWaveIcon active={listening} />}
        {/* בועת "דבר איתי" במעבר עכבר/מיקוד מקלדת. דקורטיבית (aria-hidden) כי השם
            הנגיש כבר ב-aria-label. בזמן האזנה/עיבוד לא מוצגת: החיווי הטקסטואלי
            ("מקשיב…") מספיק ולא רוצים שיחפפו. */}
        {!listening && !thinking && <span className="ui-tip" aria-hidden="true">דבר איתי</span>}
      </button>

      {/* חיווי מצב נגיש - לא מקריא כל טוקן, רק שינוי מצב משמעותי. מוסתר ויזואלית
          כשאין שגיאה (הכפתור עצמו מציג את המצב); שגיאות מוצגות בגלוי. */}
      {msg && (
        <span
          role="status"
          aria-live="polite"
          className={`voice-status ${phase === "error" ? "is-error" : ""}`.trim()}
        >
          {msg}
        </span>
      )}
    </>
  );
}

// גלי קול (חמישה פסים). לא נראה כמו מיקרופון/מכשיר הקלטה וגם לא כמו רמקול
// "הקראה" - זו שפת "מצב קול" המוכרת מצ'אטים. במנוחה הפסים סטטיים; בזמן האזנה
// (active) הם מקפצים בהשהיות שונות - חיווי שאינו צבע-בלבד (נשאר מובחן גם
// בניגודיות גבוהה ובעיוורון צבעים). האנימציה ב-CSS ונעצרת תחת
// prefers-reduced-motion.
function VoiceWaveIcon({ active }: { active: boolean }) {
  return (
    <svg
      className={`voice-wave ${active ? "is-active" : ""}`.trim()}
      width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
    >
      <rect className="voice-bar voice-bar-1" x="1.5"  y="9"   width="2.6" height="6"  rx="1.3" />
      <rect className="voice-bar voice-bar-2" x="6.1"  y="6"   width="2.6" height="12" rx="1.3" />
      <rect className="voice-bar voice-bar-3" x="10.7" y="3"   width="2.6" height="18" rx="1.3" />
      <rect className="voice-bar voice-bar-4" x="15.3" y="7"   width="2.6" height="10" rx="1.3" />
      <rect className="voice-bar voice-bar-5" x="19.9" y="9.5" width="2.6" height="5"  rx="1.3" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="voice-spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
