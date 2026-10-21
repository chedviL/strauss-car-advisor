// src/features/advisor/ChatMessage.tsx
// בועת הודעה + מרנדר Markdown. היועץ מרונדר דרך react-markdown + remark-gfm
// (GFM: טבלאות, רשימות ממוספרות, ~קו חוצה~, קישורים). מופרד מ-ChatPanel כדי
// שאפשר יהיה למדוד את הפריסה בפועל בדפדפן (כיווניות/יישור/מעטפת).
//
// אבטחה: react-markdown אינו מרנדר HTML גולמי כברירת מחדל (אין rehype-raw),
// ולכן תוכן מהמודל אינו יכול להזריק <script>/<img onerror>. קישורים נפתחים
// בטאב חדש עם rel="noopener noreferrer".
import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { rowStyle, userEnvelopeStyle, assistantEnvelopeStyle } from "./chat-message-layout.js";

export function MessageBubble({
  role,
  parts,
  streaming = false,
}: {
  role: string;
  parts: Array<Record<string, unknown>>;
  streaming?: boolean;
}) {
  const isUser = role === "user";
  const textParts = parts.filter((p) => p.type === "text").map((p) => p.text as string);
  const text = textParts.join("");
  // אפקט הקלדה: בזמן שתשובת היועץ נכתבת, חושפים את הטקסט בהדרגה בצד הלקוח.
  // כך האפקט עקבי בין אם השרת שלח את הטקסט בבת אחת (מסלול A) או זורם (מסלול B).
  const shown = useTypewriter(text, streaming && !isUser);
  if (!text) return null; // הודעות ללא טקסט (data-parts בלבד) אינן מוצגות כבועה

  // מעטפת יציבה ומעוגנת לימין (ראו chat-message-layout.ts): תחילת המשפט לא זזה
  // בזמן streaming. המשתמש/ת עם משטח רך (מצומצם לתוכן); היועץ ברוחב מלא ללא מסגרת.
  return (
    <div dir="rtl" className={`msg-row ${isUser ? "msg-row-user" : "msg-row-assistant"}`} style={rowStyle}>
      <div
        dir="rtl"
        className={isUser ? "msg-bubble msg-bubble-user" : "msg-bubble msg-bubble-assistant"}
        style={isUser ? userEnvelopeStyle : assistantEnvelopeStyle}
      >
        {isUser ? (
          <span className="msg-user-text">{text}</span>
        ) : (
          <ChatMarkdown text={shown} />
        )}
      </div>
    </div>
  );
}

// אפקט הקלדה חלק: חושף תווים בהדרגה עד לטקסט המלא. מכבד prefers-reduced-motion
// (חשיפה מיידית). כאשר הטקסט ממשיך לגדול (streaming חי) - "רודף" אחריו בקצב
// קבוע, כך שתמיד מרגיש כמו הקלדה גם אם הטוקנים מגיעים בקפיצות.
function useTypewriter(full: string, enabled: boolean): string {
  const [count, setCount] = useState(enabled ? 0 : full.length);
  const rafStart = useRef<number | null>(null);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (!enabled || reduced.current) {
      setCount(full.length);
      return;
    }
    let raf = 0;
    const CHARS_PER_SEC = 90; // קצב הקלדה נעים
    rafStart.current = null;
    let base = 0;
    setCount((c) => {
      base = Math.min(c, full.length);
      return base;
    });
    const step = (ts: number) => {
      if (rafStart.current === null) rafStart.current = ts;
      const elapsed = (ts - rafStart.current) / 1000;
      const target = Math.min(full.length, base + Math.floor(elapsed * CHARS_PER_SEC));
      setCount(target);
      if (target < full.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [full, enabled]);

  // כשה-streaming נגמר, מוודאים שהטקסט המלא מוצג.
  useEffect(() => {
    if (!enabled) setCount(full.length);
  }, [enabled, full.length]);

  return enabled && !reduced.current ? full.slice(0, count) : full;
}

// מרנדר Markdown בטוח (ללא HTML גולמי) עם קומפוננטות ממותגות RTL.
// כל העיצוב ב-globals.css תחת .chat-md כדי לשמור על עקביות וטוקנים.
function ChatMarkdown({ text }: { text: string }) {
  return (
    <div dir="rtl" className="chat-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // טבלה עטופה במכל גליל כדי שלא תשבור פריסה במסך צר.
          table: (props: ComponentPropsWithoutRef<"table">) => (
            <div className="chat-md-tablewrap">
              <table {...props} />
            </div>
          ),
          a: ({ href, children, ...rest }: ComponentPropsWithoutRef<"a">) => (
            <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
