// src/features/advisor/ChatPanel.tsx
"use client";
// פאנל שיחה חי מול המודל (claude-sonnet-5-5) דרך /api/chat.
// מציג הודעת משתמש מיד וחיווי המתנה מוצרי קצר (ללא שמות כלים פנימיים).
// המספרים/הזכאות אינם נקבעים כאן - הם מגיעים מהכלים/המנוע דרך המודל.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { PayslipUpload } from "./PayslipUpload.js";
import { MessageBubble } from "./ChatMessage.js";


export interface ChatPanelProps {
  initialMessages?: Array<{ id: string; role: string; parts: unknown }>;
  /** הצגת שאלות לדוגמה עדינות כשאין עדיין שיחה. */
  showExamples?: boolean;
}

const EXAMPLES = [
  "אם אעבור לרכב חשמלי, כמה זה ישנה לי בנטו?",
  "יש לי 5 ילדים - מה נותן המסלול המשפחתי?",
  "כמה אקבל אם אוותר על הרכב ואקבל אחזקה?",
];

export function ChatPanel({ initialMessages = [], showExamples = false }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const router = useRouter();
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    messages: initialMessages as never,
  });
  const busy = status === "submitted" || status === "streaming";
  const lastSentText = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && status === "ready") router.refresh();
    wasBusy.current = busy;
  }, [status, busy, router]);

  // גלילה עדינה לתחתית כשמגיעות הודעות חדשות.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);

  const savePhase = lastTurnSavePhase(messages);
  const saveFailed = !busy && savePhase === "failed";
  const empty = messages.length === 0;

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

  return (
    <section
      className="card"
      aria-label="שיחה עם היועץ"
      style={{
        borderRadius: "var(--radius-lg)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        // אזור קריאה מרווח; המחיצה אל הקומפוזר נשארת תמיד גלויה.
        minHeight: empty ? "auto" : 420,
      }}
    >
      {/* אזור קריאה */}
      {!empty && (
        <div
          ref={scrollRef}
          className="scroll-y"
          aria-live="polite"
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--space-4)", flex: 1, maxHeight: "56vh" }}
        >
          {messages.map((m) => (
            <MessageBubble key={m.id} role={m.role} parts={m.parts} />
          ))}
          {busy && <TypingHint />}
          {!busy && savePhase === "retrying" && (
            <div style={{ color: "var(--color-muted)", fontSize: "var(--font-sm)" }} aria-live="polite">שומר…</div>
          )}
          {error && (
            <div role="alert" style={{ color: "var(--color-loss)", fontSize: "var(--font-sm)" }}>
              שגיאה בשיחה. נסו שוב בעוד רגע.
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
        </div>
      )}

      {/* קומפוזר - תמיד בתחתית, אינו מסתיר הודעות */}
      <div style={{ borderTop: empty ? "none" : "1px solid var(--color-border)", padding: "var(--space-3)", background: "var(--color-surface)" }}>
        <form onSubmit={submit} style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end" }}>
          {/* צירוף תלוש: העלאה + חילוץ (באישור) + אישור/עריכה + החלה על התיק */}
          <PayslipUpload onApplied={() => router.refresh()} />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) submit(e); }}
            rows={1}
            placeholder="כתבו לי מה תרצו לבדוק…"
            style={{ flex: 1, borderRadius: "var(--radius-md)", resize: "none", minHeight: 44, maxHeight: 160, lineHeight: 1.5 }}
            disabled={busy}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || input.trim() === ""}>
            שליחה
          </button>
        </form>

        {/* שאלות לדוגמה עדינות - רק במסך הפתיחה */}
        {showExamples && empty && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
            {EXAMPLES.map((q) => (
              <button
                key={q}
                type="button"
                className="btn btn-ghost"
                onClick={() => sendText(q)}
                disabled={busy}
                style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-pill)", fontWeight: 500, fontSize: "var(--font-sm)", color: "var(--color-muted)" }}
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function TypingHint() {
  return (
    <div dir="rtl" style={{ display: "flex", justifyContent: "flex-start" }}>
      <div style={{ color: "var(--color-muted)", fontSize: "var(--font-sm)", background: "var(--color-surface-2)", borderRadius: "var(--radius-md)", padding: "var(--space-2) var(--space-3)" }} aria-live="polite">
        חושב…
      </div>
    </div>
  );
}


type SavePhaseUI = "saving" | "retrying" | "saved" | "failed" | null;

// מצב השמירה של התור האחרון מתוך data-saveStatus בהודעת העוזר האחרונה.
// ה-SDK ממפה data-part מסוג "saveStatus" ל-part.type === "data-saveStatus";
// ה-part האחרון משקף את ה-phase העדכני ביותר (saving -> retrying -> saved/failed).
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
