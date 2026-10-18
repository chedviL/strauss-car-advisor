// src/features/advisor/ChatMessage.tsx
// בועת הודעה ומרנדר markdown מינימלי ובטוח. מופרד מ-ChatPanel כדי שאפשר יהיה למדוד
// את הפריסה בפועל בדפדפן (כיווניות/יישור/מעטפת) מול אותו קוד שרץ במוצר.
import { rowStyle, userEnvelopeStyle, assistantEnvelopeStyle } from "./chat-message-layout.js";

export function MessageBubble({ role, parts }: { role: string; parts: Array<Record<string, unknown>> }) {
  const isUser = role === "user";
  const textParts = parts.filter((p) => p.type === "text").map((p) => p.text as string);
  const text = textParts.join("");
  if (!text) return null; // הודעות ללא טקסט (data-parts בלבד) אינן מוצגות כבועה

  // מעטפת יציבה ומעוגנת לימין (ראו chat-message-layout.ts): תחילת המשפט לא זזה בזמן
  // streaming. העובד/ת עם משטח רך (מצומצם לתוכן); היועץ ברוחב מלא, ללא מסגרת.
  return (
    <div dir="rtl" style={rowStyle}>
      <div
        dir="rtl"
        style={{
          ...(isUser ? userEnvelopeStyle : assistantEnvelopeStyle),
          background: isUser ? "var(--color-accent-soft)" : "transparent",
          color: "var(--color-text)",
          borderRadius: "var(--radius-md)",
          padding: isUser ? "var(--space-2) var(--space-3)" : "var(--space-1) var(--space-2)",
          whiteSpace: isUser ? "pre-wrap" : "normal",
          lineHeight: 1.65,
          fontSize: "var(--font-base)",
        }}
      >
        {isUser ? text : <Markdown text={text} />}
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
        <div key={`t${key++}`} style={{ margin: "var(--space-3) 0", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
          <table dir="rtl" style={{ borderCollapse: "collapse", fontSize: "var(--font-sm)", width: "100%" }}>
            <thead>
              <tr>{header.map((h, hi) => (
                <th key={hi} style={{ padding: "8px 12px", textAlign: "start", background: "var(--color-surface-2)", borderBottom: "1px solid var(--color-border)", fontWeight: 600, color: "var(--color-muted)" }}>{renderInline(h, `h${hi}`)}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} style={{ borderTop: ri === 0 ? "none" : "1px solid var(--color-border)" }}>{header.map((_, ci) => (
                  <td key={ci} style={{ padding: "8px 12px", textAlign: "start", unicodeBidi: "plaintext" }}>{renderInline(r[ci] ?? "", `c${ri}-${ci}`)}</td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>,
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
  // כיוון ויישור מפורשים: הפסקאות נשארות RTL גם כשהשורה נפתחת בשם רכב באנגלית או במספר.
  return <div dir="rtl" style={{ lineHeight: 1.5, direction: "rtl", textAlign: "right" }}>{blocks}</div>;
}
