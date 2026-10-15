// src/features/advisor/ChatPanel.tsx
"use client";
// פאנל שיחה חי מול המודל (claude-sonnet-5-5) דרך /api/chat.
// מציג הודעת משתמש מיד, מצב התקדמות אמיתי בזמן המתנה, וצ'יפים של שלבי כלים.
// המספרים/הזכאות אינם נקבעים כאן - הם מגיעים מהכלים/המנוע דרך המודל.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

// תרגום שמות כלים לתוויות עבריות קצרות (צ'יפים של "שלבי עבודה").
const TOOL_LABEL: Record<string, string> = {
  readCaseState: "קריאת מצב התיק",
  updateCase: "עדכון עובדות",
  manageScenarios: "ניהול חלופה",
  searchVehicles: "חיפוש רכבים",
  compareScenarios: "חישוב השוואה",
  openInquiry: "פנייה לנציג",
};

export function ChatPanel() {
  const [input, setInput] = useState("");
  const router = useRouter();
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const busy = status === "submitted" || status === "streaming";

  // כשתור הסתיים, מרעננים את ה-Server Components כדי שכרטיס ההשוואה
  // (אם נשמר בתור) יופיע/יתעדכן. רק במעבר מ-busy ל-ready.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && status === "ready") router.refresh();
    wasBusy.current = busy;
  }, [status, busy, router]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void sendMessage({ text });
  }

  return (
    <section
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow)",
        padding: "var(--space-3)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        maxHeight: 520,
      }}
      aria-label="שיחה עם היועץ"
    >
      <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--space-2)", flex: 1 }}>
        {messages.length === 0 && (
          <div style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>
            דברו איתי בחופשיות: מעבר לרכב חשמלי, ויתור על רכב, "מה יחסוך לי?", תיקון שכר ועוד.
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} role={m.role} parts={m.parts} />
        ))}
        {busy && (
          <div style={{ color: "var(--color-muted)", fontSize: "0.85rem" }} aria-live="polite">
            {status === "submitted" ? "חושב…" : "מנסח תשובה…"}
          </div>
        )}
        {error && (
          <div role="alert" style={{ color: "var(--color-danger, #b00)", fontSize: "0.85rem" }}>
            שגיאה בשיחה. נסו שוב בעוד רגע.
          </div>
        )}
      </div>

      <form onSubmit={submit} style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) submit(e); }}
          rows={2}
          placeholder="לדוגמה: אם אעבור לרכב חשמלי, כמה זה ישנה לי בנטו?"
          style={{
            flex: 1, border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
            padding: "var(--space-2)", font: "inherit", resize: "vertical", outline: "none",
          }}
          disabled={busy}
        />
        <button type="submit" className="btn" disabled={busy || input.trim() === ""}>
          שליחה
        </button>
      </form>
    </section>
  );
}

function MessageBubble({ role, parts }: { role: string; parts: Array<Record<string, unknown>> }) {
  const isUser = role === "user";
  const textParts = parts.filter((p) => p.type === "text").map((p) => p.text as string);
  const toolSteps = parts
    .filter((p) => typeof p.type === "string" && (p.type as string).startsWith("tool-"))
    .map((p) => (p.type as string).replace(/^tool-/, ""));

  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-start" : "flex-end" }}>
      <div
        style={{
          maxWidth: "85%",
          background: isUser ? "var(--color-bg, #f3f4f6)" : "var(--color-accent-soft, #eef2ff)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-2) var(--space-3)",
          whiteSpace: "pre-wrap",
          lineHeight: 1.5,
        }}
      >
        {!isUser && toolSteps.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
            {toolSteps.map((t, i) => (
              <span
                key={i}
                style={{
                  fontSize: "0.72rem", color: "var(--color-muted)",
                  border: "1px solid var(--color-border)", borderRadius: 999,
                  padding: "1px 8px",
                }}
              >
                {TOOL_LABEL[t] ?? t}
              </span>
            ))}
          </div>
        )}
        {textParts.join("")}
      </div>
    </div>
  );
}