// src/server/notify/mailer.ts
// שליחת מייל ברמת האפליקציה דרך SMTP (nodemailer). *נפרד* מהגדרת ה-SMTP של
// Supabase Auth: אותה ב-Supabase שולחת רק את מיילי ההתחברות ואינה נגישה לקוד שלנו.
// כאן אנו מתחברים ישירות ל-SMTP עם אותם פרטי Gmail (סיסמת אפליקציה), ללא Resend
// וללא דומיין חדש. כל המפתחות בצד שרת בלבד (ללא NEXT_PUBLIC).
//
// משתני סביבה:
//   SMTP_HOST (ברירת מחדל smtp.gmail.com), SMTP_PORT (465), SMTP_USER, SMTP_PASS,
//   MAIL_FROM (למשל "שטראוס · יועץ הרכב <you@gmail.com>"; ברירת מחדל: SMTP_USER).

import type { Transporter } from "nodemailer";

export class MailerConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super("הגדרות שליחת המייל חסרות בשרת: " + missing.join(", ") + ". ראו docs/notifications-setup.md.");
    this.name = "MailerConfigError";
  }
}

export interface MailEnv {
  host: string; port: number; secure: boolean; user: string; pass: string; from: string;
}

/** קורא ומאמת את הגדרות ה-SMTP. זורק MailerConfigError אם חסר, בלי להדפיס ערכים. */
export function readMailEnv(): MailEnv {
  const user = (process.env.SMTP_USER ?? "").trim();
  const pass = (process.env.SMTP_PASS ?? "").trim();
  const missing: string[] = [];
  if (!user) missing.push("SMTP_USER");
  if (!pass) missing.push("SMTP_PASS");
  if (missing.length > 0) throw new MailerConfigError(missing);
  const host = (process.env.SMTP_HOST ?? "smtp.gmail.com").trim();
  const port = Number((process.env.SMTP_PORT ?? "465").trim());
  return {
    host,
    port: Number.isFinite(port) ? port : 465,
    secure: port === 465, // 465=SSL ישיר; 587=STARTTLS
    user,
    pass,
    from: (process.env.MAIL_FROM ?? "").trim() || user,
  };
}

export function mailConfigured(): boolean {
  try { readMailEnv(); return true; } catch { return false; }
}

let cached: Transporter | null = null;

async function transporter(): Promise<Transporter> {
  if (cached) return cached;
  const env = readMailEnv();
  const nodemailer = await import("nodemailer");
  cached = nodemailer.createTransport({
    host: env.host, port: env.port, secure: env.secure,
    auth: { user: env.user, pass: env.pass },
    // זמני ריצה מוגבלים: מחייבים את המשלוח המיידי (סמוך לתשובת הנציג, בתוך מחזור
    // הבקשה של Next.js/Vercel) שלא לתלות את הפעולה אם ה-SMTP נתקע. בחריגה מזמן,
    // sendMail מחזיר שגיאה (אינו זורק) והמשימה נשארת pending ל-retry ע"י המתזמן.
    connectionTimeout: 10_000, // חיבור TCP
    greetingTimeout: 10_000,   // קבלת banner מה-SMTP
    socketTimeout: 20_000,     // חוסר-פעילות על ה-socket
  });
  return cached;
}

export interface SendResult { ok: boolean; error?: string }

/** שולח מייל טקסט+HTML. מחזיר ok/שגיאה מקוצרת (ללא סודות) - אינו זורק. */
export async function sendMail(args: { to: string; subject: string; text: string; html: string }): Promise<SendResult> {
  try {
    const env = readMailEnv();
    const t = await transporter();
    await t.sendMail({ from: env.from, to: args.to, subject: args.subject, text: args.text, html: args.html });
    return { ok: true };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e))
      .replace(/AUTH\s+\S+/gi, "AUTH ***")
      .slice(0, 180);
    return { ok: false, error: msg };
  }
}