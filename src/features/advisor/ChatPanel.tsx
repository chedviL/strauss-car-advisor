// src/features/advisor/ChatPanel.tsx
"use client";
// פאנל שיחה חי מול המודל (claude-sonnet-5-5) דרך /api/chat.
// מציג הודעת משתמש מיד וחיווי המתנה מוצרי קצר (ללא שמות כלים פנימיים).
// המספרים/הזכאות אינם נקבעים כאן - הם מגיעים מהכלים/המנוע דרך המודל.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";


export interface ChatPanelProps {
  initialMessages?: Array<{ id: string; role: string; parts: unknown }>;
}

export function ChatPanel({ initialMessages = [] }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const router = useRouter();
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    // שחזור היסטוריה אחרי רענון (נטען מהמסד בצד השרת).
    messages: initialMessages as never,
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
            חושב…
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

  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-start" : "flex-end" }}>
      <div
        style={{
          maxWidth: "85%",
          background: isUser ? "var(--color-bg, #f3f4f6)" : "var(--color-accent-soft, #eef2ff)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-2) var(--space-3)",
          whiteSpace: isUser ? "pre-wrap" : "normal",
          lineHeight: 1.5,
        }}
      >
        {isUser ? textParts.join("") : <Markdown text={textParts.join("")} />}
      </div>
    </div>
  );
}

// --- מרנדר markdown מינימלי ובטוח: טבלאות, bold, רשימות. ללא HTML גולמי. ---
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  // bold עם **...**
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<strong key={`${keyPrefix}-b${i++}`}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ text }: { text: string }): React.ReactElement {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0; let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    // טבלה: שורה עם | ואחריה שורת מפריד |---|
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:-]*\|[\s:|-]*$/.test(lines[i + 1]!)) {
      const header = line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|")) {
        rows.push(lines[i]!.split("|").map((c) => c.trim()).filter((_, idx, arr) => !(idx === 0 && arr[0] === "") && !(idx === arr.length - 1 && arr[arr.length - 1] === "")));
        i++;
      }
      blocks.push(
        <table key={`t${key++}`} style={{ borderCollapse: "collapse", margin: "6px 0", fontSize: "0.9rem", width: "100%" }}>
          <thead>
            <tr>{header.map((h, hi) => (
              <th key={hi} style={{ border: "1px solid var(--color-border)", padding: "3px 8px", textAlign: "start", background: "var(--color-bg, #f3f4f6)" }}>{renderInline(h, `h${hi}`)}</th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>{header.map((_, ci) => (
                <td key={ci} style={{ border: "1px solid var(--color-border)", padding: "3px 8px", textAlign: "start" }}>{renderInline(r[ci] ?? "", `c${ri}-${ci}`)}</td>
              ))}</tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    // רשימה: שורות שמתחילות ב- - או *
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={`u${key++}`} style={{ margin: "4px 0", paddingInlineStart: "1.2rem" }}>
          {items.map((it, ii) => <li key={ii}>{renderInline(it, `li${ii}`)}</li>)}
        </ul>,
      );
      continue;
    }
    // שורה ריקה
    if (line.trim() === "") { blocks.push(<div key={`sp${key++}`} style={{ height: 6 }} />); i++; continue; }
    // פסקה רגילה
    blocks.push(<div key={`p${key++}`}>{renderInline(line, `p${key}`)}</div>);
    i++;
  }
  return <div style={{ lineHeight: 1.5 }}>{blocks}</div>;
}
