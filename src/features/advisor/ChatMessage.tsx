// src/features/advisor/ChatMessage.tsx
// בועת הודעה + מרנדר Markdown. היועץ מרונדר דרך react-markdown + remark-gfm
// (GFM: טבלאות, רשימות ממוספרות, ~קו חוצה~, קישורים). מופרד מ-ChatPanel כדי
// שאפשר יהיה למדוד את הפריסה בפועל בדפדפן (כיווניות/יישור/מעטפת).
//
// אבטחה: react-markdown אינו מרנדר HTML גולמי כברירת מחדל (אין rehype-raw),
// ולכן תוכן מהמודל אינו יכול להזריק <script>/<img onerror>. קישורים נפתחים
// בטאב חדש עם rel="noopener noreferrer".
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { rowStyle, userEnvelopeStyle, assistantEnvelopeStyle } from "./chat-message-layout.js";

export function MessageBubble({
  role,
  parts,
  streaming = false,
  animateEntry = false,
}: {
  role: string;
  parts: Array<Record<string, unknown>>;
  streaming?: boolean;
  animateEntry?: boolean;
}) {
  const isUser = role === "user";
  const textParts = parts.filter((p) => p.type === "text").map((p) => p.text as string);
  const text = textParts.join("");
  if (!text) return null; // הודעות ללא טקסט (data-parts בלבד) אינן מוצגות כבועה

  // מעטפת יציבה ומעוגנת לימין (ראו chat-message-layout.ts): תחילת המשפט לא זזה
  // בזמן streaming. המשתמש/ת עם משטח רך (מצומצם לתוכן); היועץ ברוחב מלא ללא מסגרת.
  return (
    <div dir="rtl" className={`msg-row ${isUser ? "msg-row-user" : "msg-row-assistant"} ${animateEntry ? "msg-row-enter" : ""}`.trim()} style={rowStyle}>
      <div
        dir="rtl"
        className={isUser ? "msg-bubble msg-bubble-user" : "msg-bubble msg-bubble-assistant"}
        style={isUser ? userEnvelopeStyle : assistantEnvelopeStyle}
      >
        {isUser ? (
          <span className="msg-user-text">{text}</span>
        ) : (
          <ChatMarkdown text={text} />
        )}
      </div>
    </div>
  );
}

// מרנדר Markdown בטוח (ללא HTML גולמי) עם קומפוננטות ממותגות RTL.
// כל העיצוב ב-globals.css תחת .chat-md כדי לשמור על עקביות וטוקנים.
function ChatMarkdown({ text }: { text: string }) {
  return (
    <div dir="rtl" className="chat-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

const markdownComponents = {
  table: ({ children, ...props }: ComponentPropsWithoutRef<"table">) => (
    <div className="chat-md-tablewrap" role="region" aria-label="טבלה בתשובת היועץ" tabIndex={0}>
      <table dir="rtl" {...props}>{children}</table>
    </div>
  ),
  th: ({ children, ...props }: ComponentPropsWithoutRef<"th">) => (
    <th dir="rtl" {...props}>{children}</th>
  ),
  td: ({ children, ...props }: ComponentPropsWithoutRef<"td">) => (
    <td dir="rtl" {...props}><MarkdownCellContent>{children}</MarkdownCellContent></td>
  ),
  a: ({ href, children, ...props }: ComponentPropsWithoutRef<"a">) => (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
  ),
};

function MarkdownCellContent({ children }: { children?: ReactNode }) {
  if (typeof children === "string") {
    const money = /^([+-]?)(?:₪\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*₪)$/.exec(children.trim());
    if (money) {
      const amount = money[2] ?? money[3];
      return <bdi dir="ltr">{money[1]}{amount} ₪</bdi>;
    }
  }
  return <bdi dir="auto">{children}</bdi>;
}
