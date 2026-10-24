// src/features/advisor/ChatPanel.tsx
"use client";
// פאנל שיחה חי מול המודל (claude-sonnet-5-5) דרך /api/chat.
// מציג הודעת משתמש מיד וחיווי המתנה מוצרי קצר (ללא שמות כלים פנימיים).
// המספרים/הזכאות אינם נקבעים כאן - הם מגיעים מהכלים/המנוע דרך המודל.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { ArrowLeft } from "lucide-react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { PayslipUpload } from "./PayslipUpload.js";
import { VoiceInput } from "./VoiceInput.js";
import { MessageBubble } from "./ChatMessage.js";
import { LightTrail } from "../brand/LightTrail.js";
import "./vehicle-match/vehicle-match.css";
import { VehicleMatchDrawer, SparkleIcon } from "./vehicle-match/VehicleMatchDrawer.js";
import { FEATURE_NAME, INVITE } from "./vehicle-match/copy.js";
import { moveMatchState, planPrefill, scopeKey } from "./vehicle-match/match-state.js";

export interface ChatPanelProps {
  initialMessages?: Array<{ id: string; role: string; parts: unknown }>;
  /** הצגת שאלות לדוגמה עדינות כשאין עדיין שיחה. */
  showExamples?: boolean;
  /** כרטיס ההשוואה (מרונדר בשרת) - מוצג בתוך זרימת השיחה, מתחת להודעה האחרונה. */
  comparison?: React.ReactNode;
  /** המשתמש/ת המאומת/ת - רק לבידוד מצב השאלון בצד הלקוח (לא הרשאה). */
  userId: string;
  /** מזהה הבירור הפעיל מה-URL, או null בשיחה חדשה. */
  caseId?: string | null;
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

export function ChatPanel({ initialMessages = [], showExamples = false, comparison = null, userId, caseId = null }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const pendingNewTurn = useRef(false);
  const previousComparison = useRef(comparison);
  const [comparisonUpdated, setComparisonUpdated] = useState(false);
  // "איזה רכב מתאים לי?": מגירה, פתיחה מפורשת בלבד. הפעולה אינה שולחת הודעה ואינה נוגעת בתיק.
  const [matchOpen, setMatchOpen] = useState(false);
  const matchOpenerRef = useRef<HTMLElement | null>(null);
  // הכפתור מוצג בכותרת (למעלה בשמאל, תמיד) דרך portal ל-slot שהעמוד מרנדר. אם אין slot
  // (מסך אחר) - נופלים לשורה מעל תיבת ההקלדה. undefined = טרם נבדק (לא מציירים כפתור).
  const [launcherSlot, setLauncherSlot] = useState<HTMLElement | null | undefined>(undefined);
  useEffect(() => { setLauncherSlot(document.getElementById("vm-launcher-slot")); }, []);
  useEffect(() => {
    if (previousComparison.current === comparison) return;
    previousComparison.current = comparison;
    setComparisonUpdated(true);
    const timer = window.setTimeout(() => setComparisonUpdated(false), 520);
    return () => window.clearTimeout(timer);
  }, [comparison]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [draftAsk, setDraftAsk] = useState<{ draft: string; proposed: string } | null>(null);
  const [replacedDraft, setReplacedDraft] = useState<string | null>(null);
  const [phIndex, setPhIndex] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const [busyStage, setBusyStage] = useState(0);
  const router = useRouter();
  const { messages, sendMessage, setMessages, status, error } = useChat({
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
  const knownMessageIds = useRef(new Set(initialMessages.map((message) => message.id)));
  const [newMessageIds, setNewMessageIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    pendingNewTurn.current = false;
    knownMessageIds.current = new Set(initialMessages.map((message) => message.id));
    setNewMessageIds(new Set());
  }, [caseId, initialMessages]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // מצב התחתית משתנה רק בגלילת המשתמש/גלילה מפורשת, לא כתוצאה משינוי גובה תוכן.
  // עדכון מצב הגלילה הידנית + כיווץ הכותרת כשגוללים (לפינוי מקום).
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

  useEffect(() => {
    const added = messages.filter((message) => !knownMessageIds.current.has(message.id));
    if (!added.length) return;
    for (const message of added) knownMessageIds.current.add(message.id);
    if (pendingNewTurn.current) {
      const addedIds = added.map((message) => message.id);
      setNewMessageIds((current) => new Set([...current, ...addedIds]));
      window.setTimeout(() => {
        setNewMessageIds((current) => {
          const next = new Set(current);
          for (const id of addedIds) next.delete(id);
          return next;
        });
      }, 300);
    }
    if (isAtBottom.current) requestAnimationFrame(() => scrollToBottom("auto"));
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !hasConversation || typeof ResizeObserver === "undefined") return;
    const observed = new Set<Element>();
    const observer = new ResizeObserver(() => {
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
      setShowScrollBtn(distance > 120);
      if (isAtBottom.current) element.scrollTop = element.scrollHeight;
    });
    const observeChildren = () => {
      for (const child of Array.from(element.children)) {
        if (observed.has(child)) continue;
        observed.add(child);
        observer.observe(child);
      }
    };
    observeChildren();
    const mutations = new MutationObserver(observeChildren);
    mutations.observe(element, { childList: true });
    return () => {
      mutations.disconnect();
      observer.disconnect();
    };
  }, [hasConversation]);

  const wasBusy = useRef(false);
  const cardRefreshedThisTurn = useRef(false);
  const refreshCardAfterTurn = useRef(false);
  const resumePayslip = useRef<{ caseId: string; uploadId: string } | null>(null);
  const sendPayslipContinuation = useCallback((caseId: string, uploadId: string) => {
    // marker per-session: מונע שליחה כפולה בלחיצה כפולה, אבל לא חוסם אחרי רענון.
    // sessionStorage נמחק בסגירת הלשונית — כך רענון מאפשר שליחה מחדש אם צריך.
    const marker = `strauss:payslip-confirmed:${uploadId}`;
    if (sessionStorage.getItem(marker) === "sent") return;
    sessionStorage.setItem(marker, "sent");
    void sendMessage(
      { text: "אישרתי את נתוני התלוש, אפשר להמשיך." },
      { body: { caseId } },
    );
  }, [sendMessage]);
  useEffect(() => {
    // בסיום התור: רק מאפסים את הדגל. אין צורך ב-router.refresh() לתור טקסט רגיל
    // (ההודעות כבר במצב הלקוח דרך useChat) - רענון כזה גרם לקפיצה של כל החלון
    // בגלל רינדור-שרת מחדש. רענון השרת מתבצע רק כשמגיע אירוע השוואה אמיתי
    // (ה-effect הבא), שבו הכרטיס המרונדר-בשרת אכן צריך להישלף מחדש.
    if (wasBusy.current && status === "ready") {
      pendingNewTurn.current = false;
      if (resumePayslip.current) {
        const queued = resumePayslip.current;
        resumePayslip.current = null;
        sendPayslipContinuation(queued.caseId, queued.uploadId);
      }
      cardRefreshedThisTurn.current = false;
      if (refreshCardAfterTurn.current) {
        refreshCardAfterTurn.current = false;
        router.refresh();
      }
    }
    wasBusy.current = busy;
  }, [status, busy, sendPayslipContinuation, router]);

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
      refreshCardAfterTurn.current = true;
      if (!busy) {
        refreshCardAfterTurn.current = false;
        router.refresh();
      }
    }
  }, [cardEvents, router, busy]);

  // סנכרון ה-URL למזהה הבירור הפעיל שהשרת החזיר (data-activeCase): כך רענון
  // ישחזר את אותה שיחה. replaceState - בלי ניווט/טעינה מחדש.
  const activeCase = latestActiveCase(messages as never);
  const previousCaseId = useRef(caseId);
  useEffect(() => {
    const previous = previousCaseId.current;
    if (previous !== caseId) {
      const serverCreatedThisConversation = !!caseId && activeCase === caseId;
      if (!serverCreatedThisConversation) setMessages(initialMessages as never[]);
      previousCaseId.current = caseId;
    }
  }, [activeCase, caseId, initialMessages, setMessages]);
  useEffect(() => {
    if (!activeCase || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("c") !== activeCase) {
      url.searchParams.set("c", activeCase);
      window.history.replaceState(null, "", url.toString());
    }
  }, [activeCase]);

  // שיחה שהתחילה "חדשה" ונפתח לה בירור: מעבירים את מצב השאלון למפתח הבירור (לא מערבבים בירורים).
  const effectiveCaseId = caseId ?? activeCase;
  useEffect(() => {
    if (caseId === null && activeCase && typeof window !== "undefined") {
      moveMatchState(window.sessionStorage, scopeKey(userId, null), scopeKey(userId, activeCase));
    }
  }, [caseId, activeCase, userId]);

  const openMatch = useCallback((e: React.MouseEvent<HTMLElement>) => {
    matchOpenerRef.current = e.currentTarget;
    setMatchOpen(true);
  }, []);
  const closeMatch = useCallback(() => {
    setMatchOpen(false);
    // אחרי שהדיאלוג חדל להיות מודאלי (inert הוסר) - מחזירים פוקוס לכפתור הפתיחה.
    requestAnimationFrame(() => matchOpenerRef.current?.focus());
  }, []);
  // "בדקו אותו מול הרכב שלי": סוגר ומכין טקסט בתיבה. לא שולח, לא פותח בירור, לא משנה רכב/חלופה.
  // טיוטה קיימת אינה נדרסת בלי החלטה: אפשר להוסיף, להחליף (עם החזרה) או להשאיר.
  const prefillFromMatch = useCallback((text: string) => {
    setMatchOpen(false);
    const plan = planPrefill(input, text);
    if (plan.kind === "set") { setInput(plan.text); setDraftAsk(null); setReplacedDraft(null); }
    else setDraftAsk({ draft: plan.draft, proposed: plan.proposed });
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  }, [input]);
  function resolveDraft(choice: "append" | "replace" | "keep") {
    if (!draftAsk) return;
    if (choice === "append") setInput(`${draftAsk.draft.trimEnd()}\n${draftAsk.proposed}`);
    if (choice === "replace") { setReplacedDraft(draftAsk.draft); setInput(draftAsk.proposed); }
    setDraftAsk(null);
    inputRef.current?.focus();
  }
  function restoreDraft() {
    if (replacedDraft !== null) setInput(replacedDraft);
    setReplacedDraft(null);
    inputRef.current?.focus();
  }

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
    pendingNewTurn.current = true;
    lastSentText.current = clean;
    void sendMessage({ text: clean });
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendText(text);
    setInput("");
  }
  function retrySave() {
    if (lastSentText.current) sendText(lastSentText.current);
  }

  const isOpening = empty && !comparison;
  const launcherButton = (
    <button
      type="button"
      className="vm-chip vm-chip-header"
      aria-haspopup="dialog"
      aria-expanded={matchOpen}
      onClick={openMatch}
    >
      <SparkleIcon /> {FEATURE_NAME}
    </button>
  );
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
                animateEntry={newMessageIds.has(m.id)}
              />
            ))}
            {/* TypingHint עם aria-live="polite" ממוקד רק על חיווי ה-"חשיבה".
                מוסתר ברגע שהיועץ התחיל לכתוב טקסט. */}
            {showTyping && <TypingHint label={busyLabel} />}
            {/* כרטיס ההשוואה מגיע אחרי תשובת היועץ */}
            {comparison && !busy && <div className={`cmp-inline ${comparisonUpdated ? "is-updated" : ""}`.trim()}>{comparison}</div>}
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
        {launcherSlot === null && <div className="composer-extras">{launcherButton}</div>}
        {launcherSlot && createPortal(launcherButton, launcherSlot)}
        {draftAsk && (
          <div className="vm-draft-notice" role="group" aria-label="יש טיוטה בתיבת ההקלדה">
            <p>יש כבר טיוטה בתיבה. מה לעשות עם ההצעה: ״{draftAsk.proposed}״?</p>
            <div className="vm-actions-row">
              <button type="button" className="btn" onClick={() => resolveDraft("append")}>הוספה בסוף הטיוטה</button>
              <button type="button" className="btn" onClick={() => resolveDraft("replace")}>החלפת הטיוטה</button>
              <button type="button" className="btn btn-ghost" onClick={() => resolveDraft("keep")}>השארת הטיוטה כמות שהיא</button>
            </div>
          </div>
        )}
        {replacedDraft !== null && !draftAsk && (
          <div className="vm-draft-notice" role="status">
            <span>הטיוטה הקודמת הוחלפה.</span>
            <button type="button" className="btn btn-ghost" onClick={restoreDraft}>החזרת הטיוטה הקודמת</button>
          </div>
        )}
        <form onSubmit={submit} className={`composer-row ${empty ? "is-hero" : ""}`.trim()}>
          {/* צירוף תלוש: העלאה + חילוץ (באישור) + אישור/עריכה + החלה על התיק */}
          <PayslipUpload
            onApplied={({ caseId: resumeCaseId, uploadId }) => {
              if (resumeCaseId && typeof window !== "undefined") {
                const url = new URL(window.location.href);
                if (url.searchParams.get("c") !== resumeCaseId) {
                  url.searchParams.set("c", resumeCaseId);
                  window.history.replaceState(null, "", url.toString());
                }
              }
              if (resumeCaseId) {
                if (busy) resumePayslip.current = { caseId: resumeCaseId, uploadId };
                else sendPayslipContinuation(resumeCaseId, uploadId);
              }
            }}
            caseId={effectiveCaseId ?? null}
          />

          {/* קלט דיבור: התמלול נכנס לתיבת הטקסט לעריכה - לא נשלח אוטומטית.
              מצטרף לטקסט קיים אם כבר הוקלד משהו. */}
          <VoiceInput
            disabled={busy}
            onTranscript={(text) => {
              setInput((prev) => (prev.trim() === "" ? text : `${prev.trim()} ${text}`));
            }}
          />

          <div className="composer-field">
            {/* placeholder מונפש: עף למעלה ונכנס מלמטה. מוסתר כשיש טקסט/focus.
                אינו תווית נגישה - יש aria-label קבוע ל-textarea. */}
            {showPlaceholderLayer && (
              <span key={phIndex} className="composer-ph" aria-hidden="true">
                {PLACEHOLDER_EXAMPLES[phIndex]}
              </span>
            )}
            <textarea
              ref={inputRef}
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
        {/* הזמנה עדינה במסך פתיחה בלבד. אינה פותחת את המגירה אוטומטית. */}
        {isOpening && (
          <button type="button" className="vm-invite" onClick={openMatch} aria-haspopup="dialog">
            <span className="vm-invite-icon" aria-hidden="true"><SparkleIcon size={20} /></span>
            <span className="vm-invite-text">
              <strong className="vm-invite-title">
                {INVITE.titleParts.map((p) => <span key={p} className="vm-nobreak">{p} </span>)}
              </strong>
              <span>{INVITE.body}</span>
            </span>
            <span className="vm-invite-go">{INVITE.cta} <ArrowLeft size={15} aria-hidden={true} /></span>
          </button>
        )}
      </div>

      <VehicleMatchDrawer
        open={matchOpen}
        onClose={closeMatch}
        onPrefill={prefillFromMatch}
        userId={userId}
        caseId={effectiveCaseId}
      />
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
