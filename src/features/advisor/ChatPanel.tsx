// src/features/advisor/ChatPanel.tsx
"use client";
// פאנל שיחה חי מול המודל (claude-sonnet-5-5) דרך /api/chat.
// מציג הודעת משתמש מיד וחיווי המתנה מוצרי קצר (ללא שמות כלים פנימיים).
// המספרים/הזכאות אינם נקבעים כאן - הם מגיעים מהכלים/המנוע דרך המודל.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { PayslipUpload } from "./PayslipUpload.js";
import { MessageBubble } from "./ChatMessage.js";
import { LightTrail } from "../brand/LightTrail.js";


export interface ChatPanelProps {
  initialMessages?: Array<{ id: string; role: string; parts: unknown }>;
  /** הצגת שאלות לדוגמה עדינות כשאין עדיין שיחה. */
  showExamples?: boolean;
  /** כרטיס ההשוואה (מרונדר בשרת) - מוצג בתוך זרימת השיחה, מתחת להודעה האחרונה. */
  comparison?: React.ReactNode;
}

// שלבי חיווי חשיבה גנריים (מתחלפים כדי שלא ישעמם). אינם מתארים שלב אמיתי במערכת
// פרט ל"מחשב את ההשוואה" שמוצג רק עם אירוע השוואה ממשי.
const BUSY_STAGES = ["רגע, בודק…", "שולף נתונים…", "בונה את התמונה…"];

// דוגמאות מתחלפות בתוך תיבת ההקלדה (placeholder בלבד). מתחלפות אנכית ברכות,
// נעצרות כשהשדה ממוקד או מכיל טקסט. אינן מחליפות תווית נגישה (יש aria-label קבוע).
const PLACEHOLDER_EXAMPLES = [
  "איזה חשמלי ישאיר לי הכי הרבה נטו?",
  "כמה אחסוך במעבר ל-ATTO 3?",
  "מה יקרה אם אוותר על הרכב?",
];

export function ChatPanel({ initialMessages = [], showExamples = false, comparison = null }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [phIndex, setPhIndex] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const [busyStage, setBusyStage] = useState(0);
  const router = useRouter();
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      // שולחים את מזהה הבירור הפעיל מה-URL (?c=). הבעלות נאכפת בשרת; מזהה מהלקוח
      // אינו הרשאה. בלי ?c= (מסך נקי) לא נשלח מזהה -> השרת פותח בירור חדש בהודעה.
      prepareSendMessagesRequest: ({ body, messages: ms }) => {
        const c = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("c") : null;
        return { body: { ...body, messages: ms, ...(c ? { caseId: c } : {}) } };
      },
    }),
    messages: initialMessages as never,
  });
  const busy = status === "submitted" || status === "streaming";
  const lastSentText = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // גלילה חכמה: stick-to-bottom כשהמשתמש/ת קרובים לתחתית, אחרת לא גוזלים
  // את שליטתם. isAtBottom מתעדכן בגלילה; showScrollBtn מציג כפתור "למטה".
  const isAtBottom = useRef(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // עדכון isAtBottom בגלילה ידנית + כיווץ הכותרת כשגוללים (לפינוי מקום).
  const headerCollapsed = useRef(false);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottom.current = distFromBottom < 80;
    setShowScrollBtn(distFromBottom > 120);
    // כיווץ הכותרת בהנפשה כשגוללים. hysteresis: מכווצים מעל 48px ומחזירים רק
    // מתחת 8px - שני ספים נפרדים כדי למנוע ריצוד (הכיווץ משנה גובה ולכן גם את
    // מיקום הגלילה; סף יחיד היה גורם ל-toggle הלוך-ושוב על הגבול = "קפיצות").
    if (typeof document === "undefined") return;
    const top = el.scrollTop;
    if (!headerCollapsed.current && top > 48) {
      headerCollapsed.current = true;
      document.body.classList.add("chat-scrolled");
    } else if (headerCollapsed.current && top < 8) {
      headerCollapsed.current = false;
      document.body.classList.remove("chat-scrolled");
    }
  }, []);

  // ניקוי ה-class ביציאה מהמסך (כדי שלא יישאר מכווץ במסכים אחרים).
  useEffect(() => {
    return () => {
      headerCollapsed.current = false;
      if (typeof document !== "undefined") document.body.classList.remove("chat-scrolled");
    };
  }, []);

  // נעילת גלילת העמוד כל עוד השיחה פעילה: הגלילה מתרחשת אך ורק בתוך אזור
  // ההודעות (.chat-messages). class על <html>/<body> נועל אותם לגובה המסך
  // ללא תלות בשרשרת ה-flex (הגנה חסינה). מתנקה ביציאה מהמסך.
  const hasConversation = messages.length > 0 || comparison != null;
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const body = document.body;
    if (hasConversation) {
      root.classList.add("chat-locked");
      body.classList.add("chat-locked");
    } else {
      root.classList.remove("chat-locked");
      body.classList.remove("chat-locked");
    }
    return () => {
      root.classList.remove("chat-locked");
      body.classList.remove("chat-locked");
    };
  }, [hasConversation]);

  // גלילה אוטומטית לתחתית — רק אם המשתמש/ת כבר שם/ה. בכניסת הודעה חדשה — smooth.
  useEffect(() => {
    if (!isAtBottom.current) return;
    scrollToBottom(busy ? "auto" : "smooth");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, busy]);

  // בזמן כתיבת התשובה (busy) הטקסט נחשף בהדרגה (אפקט הקלדה) ולכן הגובה גדל בלי
  // ש-messages.length משתנה. מצמידים לתחתית בקצב קבוע כל עוד המשתמש/ת שם/ה.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      if (isAtBottom.current) scrollToBottom("auto");
    }, 120);
    return () => clearInterval(t);
  }, [busy, scrollToBottom]);

  const wasBusy = useRef(false);
  const cardRefreshedThisTurn = useRef(false);
  useEffect(() => {
    // בסיום התור: רק מאפסים את הדגל. אין צורך ב-router.refresh() לתור טקסט רגיל
    // (ההודעות כבר במצב הלקוח דרך useChat) - רענון כזה גרם לקפיצה של כל החלון
    // בגלל רינדור-שרת מחדש. רענון השרת מתבצע רק כשמגיע אירוע השוואה אמיתי
    // (ה-effect הבא), שבו הכרטיס המרונדר-בשרת אכן צריך להישלף מחדש.
    if (wasBusy.current && status === "ready") {
      cardRefreshedThisTurn.current = false;
    }
    wasBusy.current = busy;
  }, [status, busy]);

  // רענון מיידי של הכרטיס כשמגיע אירוע data-comparison מהשרת (באמצע התור,
  // לפני סיום הניסוח). לא ממתינים ל-status="ready". מונה כדי לרענן פעם אחת לאירוע.
  const cardEvents = countComparisonParts(messages as never);
  const lastCardEvents = useRef(0);
  useEffect(() => {
    if (cardEvents > lastCardEvents.current) {
      lastCardEvents.current = cardEvents;
      // מדידה אופציונלית (?cardtiming=1): חותמת זמן בעת קבלת אירוע הכרטיס,
      // כדי למדוד בדפדפן את הפער בין קבלת האירוע לבין רינדור הכרטיס בפועל.
      if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("cardtiming")) {
        // eslint-disable-next-line no-console
        console.log(`[card] event received at ${Math.round(performance.now())}ms -> router.refresh()`);
      }
      cardRefreshedThisTurn.current = true;
      router.refresh();
    }
  }, [cardEvents, router]);

  // סנכרון ה-URL למזהה הבירור הפעיל שהשרת החזיר (data-activeCase): כך רענון
  // ישחזר את אותה שיחה. replaceState - בלי ניווט/טעינה מחדש.
  const activeCase = latestActiveCase(messages as never);
  useEffect(() => {
    if (!activeCase || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("c") !== activeCase) {
      url.searchParams.set("c", activeCase);
      window.history.replaceState(null, "", url.toString());
    }
  }, [activeCase]);

  const empty = messages.length === 0;

  // סבב שלבי החשיבה כל ~1.6 שנ׳ בזמן עבודה; מתאפס כשמסתיים.
  useEffect(() => {
    if (!busy) { setBusyStage(0); return; }
    // קצב רגוע: מתקדם שלב אחד כל ~2.6 שנ׳, ונעצר בשלב האחרון (לא לולאה) כדי שלא
    // יחזור על עצמו שוב ושוב בזמן המתנה ארוכה.
    const t = setInterval(() => setBusyStage((s) => Math.min(s + 1, BUSY_STAGES.length - 1)), 2600);
    return () => clearInterval(t);
  }, [busy]);

  // שכבת ה-placeholder המונפש מוצגת רק במסך פתיחה, כשהשדה ריק (גם ב-focus מותר -
   // הטקסט נעלם רק כשמתחילים להקליד, כדי שהאנימציה תהיה חלקה).
  const showPlaceholderLayer = showExamples && empty && input.trim() === "";
  // ההחלפה האוטומטית נעצרת ב-focus (כדי לא להסיח בזמן שהמשתמש עומד להקליד).
  const rotatePlaceholders = showPlaceholderLayer && !inputFocused;
  useEffect(() => {
    if (!rotatePlaceholders) return;
    const t = setInterval(() => setPhIndex((i) => (i + 1) % PLACEHOLDER_EXAMPLES.length), 2200);
    return () => clearInterval(t);
  }, [rotatePlaceholders]);

  const savePhase = lastTurnSavePhase(messages);
  const saveFailed = !busy && savePhase === "failed";
  // חיווי חשיבה עם שלבים מתחלפים (כדי שלא ישעמם). כשמגיע אירוע השוואה אמיתי -
  // נועלים על "מחשב את ההשוואה…" (אות אמיתי). אחרת מחליפים בין שלבים גנריים.
  const hasCmpEvent = lastMessageHasComparison(messages as never);
  const busyLabel = hasCmpEvent ? "מחשב את ההשוואה…" : (BUSY_STAGES[busyStage] ?? "רגע, בודק…");
  // מציגים את חיווי ה"חשיבה" רק כל עוד היועץ עדיין לא התחיל לכתוב טקסט.
  // ברגע שמגיע הטוקן הראשון של התשובה - מסתירים אותו (אחרת "בודק" ממשיך
  // להופיע מעל התשובה שכבר מוזרמת).
  const assistantStartedWriting = lastAssistantHasText(messages as never);
  const showTyping = busy && !assistantStartedWriting;

  function sendText(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    lastSentText.current = clean;
    void sendMessage({ text: clean });
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    sendText(text);
  }
  function retrySave() {
    if (lastSentText.current) sendText(lastSentText.current);
  }

  const isOpening = empty && !comparison;
  return (
    <section
      className={`chat-card ${isOpening ? "chat-card-opening" : ""}`.trim()}
      aria-label="שיחה עם היועץ"
    >
      {/* אזור קריאה */}
      {(!empty || comparison) && (
        <div className="chat-read-area">
          <div
            ref={scrollRef}
            className="scroll-y chat-messages"
            onScroll={onScroll}
            role="log"
            aria-label="הודעות השיחה"
            aria-live="off"
          >
            {messages.map((m, idx) => (
              <MessageBubble
                key={m.id}
                role={m.role}
                parts={m.parts}
                streaming={busy && idx === messages.length - 1 && m.role === "assistant"}
              />
            ))}
            {/* TypingHint עם aria-live="polite" ממוקד רק על חיווי ה-"חשיבה".
                מוסתר ברגע שהיועץ התחיל לכתוב טקסט. */}
            {showTyping && <TypingHint label={busyLabel} />}
            {/* כרטיס ההשוואה מגיע אחרי תשובת היועץ */}
            {comparison && !busy && <div className="cmp-inline">{comparison}</div>}
            {!busy && savePhase === "retrying" && (
              <div style={{ color: "var(--color-muted)", fontSize: "var(--font-sm)" }} aria-live="polite">שומר…</div>
            )}
            {error && (
              <div role="alert" style={{ color: "var(--color-loss)", fontSize: "var(--font-sm)" }}>
                שגיאה בשיחה. נסה שוב בעוד רגע.
              </div>
            )}
            {saveFailed && (
              <div role="alert" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", color: "var(--color-loss)", fontSize: "var(--font-sm)", background: "var(--color-loss-soft)", borderRadius: "var(--radius-sm)", padding: "var(--space-2) var(--space-3)" }}>
                <span>השיחה טרם נשמרה. ייתכן שלא תופיע אחרי רענון.</span>
                <button type="button" className="btn" onClick={retrySave} disabled={busy} style={{ marginInlineStart: "auto", padding: "4px 14px" }}>
                  נסה לשמור שוב
                </button>
              </div>
            )}
            {/* עוגן לגלילה — scrollRef.scrollHeight מכוון תמיד לכאן. */}
            <div aria-hidden="true" style={{ height: 1 }} />
          </div>

          {/* כפתור "גלול למטה" — מוצג כשהמשתמש/ת גלל/ה למעלה */}
          {showScrollBtn && (
            <button
              type="button"
              className="scroll-down-btn"
              aria-label="גלול לתחתית השיחה"
              onClick={() => { isAtBottom.current = true; scrollToBottom("smooth"); }}
            >
              <ScrollDownIcon />
            </button>
          )}
        </div>
      )}

      {/* קומפוזר - תיבת בוט מסוגננת בסגנון הכניסה. אין כפתורי הצעות. */}
      <div className="composer" style={{ borderTop: empty ? "none" : "1px solid var(--color-border)" }}>
        <form onSubmit={submit} className={`composer-row ${empty ? "is-hero" : ""}`.trim()}>
          {/* צירוף תלוש: העלאה + חילוץ (באישור) + אישור/עריכה + החלה על התיק */}
          <PayslipUpload onApplied={() => router.refresh()} />

          <div className="composer-field">
            {/* placeholder מונפש: עף למעלה ונכנס מלמטה. מוסתר כשיש טקסט/focus.
                אינו תווית נגישה - יש aria-label קבוע ל-textarea. */}
            {showPlaceholderLayer && (
              <span key={phIndex} className="composer-ph" aria-hidden="true">
                {PLACEHOLDER_EXAMPLES[phIndex]}
              </span>
            )}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) submit(e); }}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              rows={1}
              aria-label="כתוב לי מה תרצה לבדוק"
              placeholder={showPlaceholderLayer ? "" : "כתוב לי מה תרצה לבדוק…"}
              className="composer-input"
              style={{ minHeight: empty ? 52 : 40, maxHeight: 160, fontSize: empty ? "var(--font-lg)" : "var(--font-base)" }}
              disabled={busy}
            />
          </div>

          <button type="submit" className="composer-send" aria-label="שליחה" disabled={busy || input.trim() === ""}>
            <SendIcon />
          </button>
        </form>
      </div>
    </section>
  );
}

function SendIcon() {
  // חץ שליחה. ב-RTL מצביע שמאלה (קדימה).
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ScrollDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TypingHint({ label = "רגע, בודק…" }: { label?: string }) {
  return (
    <div dir="rtl" className="typing-row" aria-live="polite">
      <div className="typing-hint">
        <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
        <span key={label} className="typing-label">{label}</span>
        <LightTrail mode="active" variant="inline" />
      </div>
    </div>
  );
}


type SavePhaseUI = "saving" | "retrying" | "saved" | "failed" | null;

// מצב השמירה של התור האחרון מתוך data-saveStatus בהודעת העוזר האחרונה.
// ה-SDK ממפה data-part מסוג "saveStatus" ל-part.type === "data-saveStatus";
// ה-part האחרון משקף את ה-phase העדכני ביותר (saving -> retrying -> saved/failed).
// מחזיר את מזהה הבירור הפעיל האחרון מאירועי data-activeCase (לסנכרון ה-URL).
function latestActiveCase(messages: Array<{ parts?: Array<Record<string, unknown>> }>): string | null {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
    const parts = messages[i]?.parts ?? [];
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j] as { type?: string; data?: { caseId?: string } };
      if (part.type === "data-activeCase" && part.data?.caseId) return part.data.caseId;
    }
  }
  return null;
}

// סופר את אירועי data-comparison בכל ההודעות (part.type === "data-comparison").
// עלייה במספר = כרטיס חדש נשמר בשרת -> רענון מיידי.
// האם ההודעה האחרונה (העוזר, בתור הנוכחי) כבר כוללת אירוע השוואה - אות אמיתי
// שאפשר להציג "מחשב את ההשוואה" במקום הודעה גנרית.
function lastMessageHasComparison(messages: Array<{ role: string; parts?: Array<Record<string, unknown>> }>): boolean {
  const last = messages?.[messages.length - 1];
  if (!last || last.role !== "assistant") return false;
  return (last.parts ?? []).some((p) => (p as { type?: string }).type === "data-comparison");
}

// האם ההודעה האחרונה (העוזר) כבר כוללת טקסט לא-ריק - כלומר, התחיל להיכתב
// מענה. משמש להסתרת חיווי ה"חשיבה" ברגע שהתשובה מתחילה להופיע.
function lastAssistantHasText(messages: Array<{ role: string; parts?: Array<Record<string, unknown>> }>): boolean {
  const last = messages?.[messages.length - 1];
  if (!last || last.role !== "assistant") return false;
  return (last.parts ?? []).some(
    (p) => (p as { type?: string }).type === "text" && ((p as { text?: string }).text ?? "").trim().length > 0,
  );
}

function countComparisonParts(messages: Array<{ parts?: Array<Record<string, unknown>> }>): number {
  let n = 0;
  for (const m of messages ?? []) {
    for (const part of m.parts ?? []) {
      if ((part as { type?: string }).type === "data-comparison") n += 1;
    }
  }
  return n;
}

function lastTurnSavePhase(messages: Array<{ role: string; parts: Array<Record<string, unknown>> }>): SavePhaseUI {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "assistant") continue;
    const statusParts = (m.parts ?? []).filter((p) => (p as { type?: string }).type === "data-saveStatus");
    if (statusParts.length === 0) return null; // תור ללא חיווי
    const last = statusParts[statusParts.length - 1] as { data?: { phase?: SavePhaseUI } };
    return last?.data?.phase ?? null;
  }
  return null;
}
