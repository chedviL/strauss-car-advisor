// src/server/notify/content.ts
// תוכן מיילי ההתראה. *אין* שכר, נתוני תלוש, סכומים או תוצאות - רק עדכון קצר
// וקישור המחייב התחברות ומחזיר לבירור הנכון (בדיקת בעלות בצד השרת).
// לעולם לא נכתב "ההשוואה מוכנה" עבור answer_recorded (תשובה שטרם הוחלה).

export type NotifyKind = "comparison_ready" | "answer_recorded";

export interface NotifyContent { subject: string; text: string; html: string }

/** קישור לבירור: עובר דרך שער שמחייב התחברות ומאמת בעלות לפני פתיחת התיק. */
export function caseLink(baseUrl: string, caseId: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/go/case/${encodeURIComponent(caseId)}`;
}

const BRAND = "שטראוס · יועץ הרכב";

function wrap(bodyHtml: string, link: string): string {
  // HTML פשוט ובטוח; אין תוכן מהמשתמש/מהמודל. RTL.
  return [
    `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#221d18;line-height:1.6;max-width:520px">`,
    `<div style="color:#6b6258;font-size:13px;letter-spacing:.04em;margin-bottom:12px">${BRAND}</div>`,
    bodyHtml,
    `<div style="margin:20px 0"><a href="${link}" style="display:inline-block;background:#1f4e6b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">מעבר לבירור</a></div>`,
    `<div style="color:#6b6258;font-size:12px">הקישור דורש התחברות. אם אינך מזהה את הפנייה, אפשר להתעלם מההודעה.</div>`,
    `</div>`,
  ].join("");
}

/** בונה נושא/טקסט/HTML לפי סוג ההתראה. ללא פרטים כספיים. */
export function buildContent(kind: NotifyKind, link: string): NotifyContent {
  if (kind === "comparison_ready") {
    const subject = "עדכון לבירור שלך: ההשוואה עודכנה";
    const line = "התקבלה תשובה מהנציג וההשוואה שלך עודכנה. אפשר לצפות בתוצאה המעודכנת בבירור.";
    return {
      subject,
      text: `${BRAND}\n\n${line}\n\nמעבר לבירור (דורש התחברות): ${link}\n`,
      html: wrap(`<p style="margin:0 0 8px">${line}</p>`, link),
    };
  }
  // answer_recorded: תשובה נרשמה אך טרם הוחלה - בלי "ההשוואה מוכנה".
  const subject = "עדכון לבירור שלך: התקבלה תשובה מהנציג";
  const line = "התקבלה תשובה מהנציג לבירור שלך. ייתכן שנדרשת פעולה קצרה כדי להשלים את העדכון. אפשר לבדוק בבירור.";
  return {
    subject,
    text: `${BRAND}\n\n${line}\n\nמעבר לבירור (דורש התחברות): ${link}\n`,
    html: wrap(`<p style="margin:0 0 8px">${line}</p>`, link),
  };
}