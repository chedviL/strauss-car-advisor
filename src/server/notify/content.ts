// src/server/notify/content.ts
// תוכן מיילי ההתראה. *אין* שכר, נתוני תלוש, סכומים או תוצאות - רק עדכון קצר
// וקישור המחייב התחברות ומחזיר לבירור הנכון (בדיקת בעלות בצד השרת).
// לעולם לא נכתב "ההשוואה מוכנה" עבור answer_recorded (תשובה שטרם הוחלה).

export type NotifyKind = "comparison_ready" | "answer_recorded";

export interface NotifyContent { subject: string; text: string; html: string }

/** קישור לבירור: עובר דרך שער שמחייב התחברות ומאמת בעלות לפני פתיחת התיק. */
export function caseLink(baseUrl: string, caseId: string, inquiryId?: string | null): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = `${base}/go/case/${encodeURIComponent(caseId)}`;
  return inquiryId ? `${path}?answer=${encodeURIComponent(inquiryId)}` : path;
}

const BRAND = "שטראוס · יועץ הרכב";

function wrap(bodyHtml: string, link: string): string {
  // מבנה טבלאי ו-inline styles לתמיכה בלקוחות מייל; אין תוכן משתמש/מודל.
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:100%;border-collapse:collapse;background-color:#f6f3ee;font-family:Arial,Helvetica,sans-serif;color:#221d18">`,
    `<tr><td align="center" style="padding:20px 12px">`,
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:100%;max-width:560px;border-collapse:collapse;background-color:#fffdfb;border:1px solid #e7ded2;border-radius:12px">`,
    `<tr><td align="right" dir="rtl" style="padding:22px 24px 20px;text-align:right;font-size:13px;font-weight:bold;line-height:1.5;color:#1f4e6b">${BRAND}</td></tr>`,
    `<tr><td align="right" dir="rtl" style="padding:0 24px 10px;text-align:right;font-size:22px;font-weight:bold;line-height:1.35;color:#221d18">התקבלה תשובה לבירור שלך</td></tr>`,
    `<tr><td align="right" dir="rtl" style="padding:0 24px 18px;text-align:right;font-size:15px;line-height:1.7;color:#4c443d">${bodyHtml}</td></tr>`,
    `<tr><td align="right" dir="rtl" style="padding:0 24px 20px;text-align:right">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="border-collapse:separate"><tr><td align="center" bgcolor="#1f4e6b" style="border-radius:7px;background-color:#1f4e6b">`,
    `<a href="${link}" dir="rtl" style="display:inline-block;padding:11px 20px;border:1px solid #1f4e6b;border-radius:7px;background-color:#1f4e6b;color:#ffffff;text-align:center;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;line-height:1.4">לצפייה בתשובה</a>`,
    `</td></tr></table>`,
    `</td></tr>`,
    `<tr><td align="right" dir="rtl" style="padding:0 24px 20px;text-align:right;font-size:12px;line-height:1.6;color:#6b6258">הקישור דורש התחברות. אם אינך מזהה את הפנייה, אפשר להתעלם מההודעה.</td></tr>`,
    `</table></td></tr></table>`,
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
      html: wrap(`<p style="margin:0">${line}</p>`, link),
    };
  }
  // answer_recorded: תשובה נרשמה אך טרם הוחלה - בלי "ההשוואה מוכנה".
  const subject = "עדכון לבירור שלך: התקבלה תשובה מהנציג";
  const line = "התקבלה תשובה מהנציג לבירור שלך. ייתכן שנדרשת פעולה קצרה כדי להשלים את העדכון. אפשר לבדוק בבירור.";
  return {
    subject,
    text: `${BRAND}\n\n${line}\n\nמעבר לבירור (דורש התחברות): ${link}\n`,
    html: wrap(`<p style="margin:0">${line}</p>`, link),
  };
}