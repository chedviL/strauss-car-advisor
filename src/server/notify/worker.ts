// src/server/notify/worker.ts
// עיבוד תור ההתראות: תופס משימות שהגיע זמנן, מברר את המייל המאומת של הנמען
// (Supabase Admin, service role - המייל לא נשמר אצלנו), בונה תוכן ללא פרטים
// כספיים, שולח, ומסמן sent/failed. ניסיונות חוזרים: backoff מוכפל ב-claim.
// רץ בחיבור worker מצומצם (strauss_notifier) שגישתו ל-notification_jobs בלבד.

import { claimDueJobs, claimJobByInquiry, markSent, markFailed, type DueJob } from "./queue.js";
import { buildContent, caseLink } from "./content.js";
import { sendMail, mailConfigured } from "./mailer.js";

/**
 * חיבור ה-worker לתור ההתראות: *אך ורק* NOTIFY_DATABASE_URL (תפקיד strauss_notifier
 * המצומצם ל-notification_jobs). אין fallback ל-MIGRATION_DATABASE_URL/DATABASE_URL
 * כדי לא להריץ את ה-worker בהרשאות רחבות. לא מוגדר -> null, וה-worker אינו רץ.
 */
function notifierConn(): string | undefined {
  const c = (process.env.NOTIFY_DATABASE_URL ?? "").trim();
  return c !== "" ? c : undefined;
}

export interface WorkerResult { claimed: number; sent: number; failed: number; skipped: number; configured: boolean }

/** מברר מייל מאומת לפי מזהה משתמש דרך Supabase Admin. null אם אין/לא נמצא. */
async function lookupEmail(userId: string): Promise<string | null> {
  const url = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) return null;
  // הגנה בעומק: רק מזהה משתמש Supabase אמיתי (uuid). בעלים סינתטי של פניות הדגמה
  // ('demo-seed:...') לעולם לא יקבל מייל.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}

/**
 * מריץ מחזור עיבוד אחד. מחזיר מונים לתפעול. אינו זורק על כשל מייל בודד -
 * המשימה נשארת pending ותנוסה שוב, עד max_attempts (ואז failed).
 */
export async function processNotifications(opts?: { limit?: number; baseUrl?: string }): Promise<WorkerResult> {
  const workerConn = notifierConn();
  const configured = mailConfigured();
  if (!workerConn) return { claimed: 0, sent: 0, failed: 0, skipped: 0, configured };
  const baseUrl = (opts?.baseUrl ?? process.env.APP_BASE_URL ?? "").trim();

  const jobs = await claimDueJobs(workerConn, opts?.limit ?? 10);
  let sent = 0, failed = 0, skipped = 0;

  for (const job of jobs) {
    const r = await sendOneJob(workerConn, job, baseUrl, configured);
    if (r === "sent") sent++;
    else if (r === "skipped") skipped++;
    else failed++;
  }
  return { claimed: jobs.length, sent, failed, skipped, configured };
}

/**
 * שולח משימה אחת ומסמן את תוצאתה. מופרד כדי שישמש גם את המסלול המיידי (סמוך
 * לתשובת הנציג) וגם את המתזמן. *חלון הכפילות* (ראו docs): הסימון sent מתבצע
 * רק אחרי ש-Gmail קיבל את המייל. אם השרת קורס בין קבלת המייל לסימון, המייל
 * כבר נשלח אך המשימה תישאר pending ותישלח שוב בניסיון הבא. אין דה-דופ מוחלט.
 */
export async function sendOneJob(
  workerConn: string, job: DueJob, baseUrl: string, configured: boolean,
): Promise<"sent" | "failed" | "skipped"> {
  if (!configured) { await markFailed(workerConn, job.id, "mail_not_configured"); return "skipped"; }
  try {
    const email = await lookupEmail(job.recipientUserId);
    if (!email) { await markFailed(workerConn, job.id, "recipient_email_not_found"); return "failed"; }
    const link = caseLink(baseUrl || "", job.caseId);
    const content = buildContent(job.kind, link);
    const r = await sendMail({ to: email, subject: content.subject, text: content.text, html: content.html });
    if (r.ok) { await markSent(workerConn, job.id); return "sent"; }
    await markFailed(workerConn, job.id, r.error ?? "send_failed");
    return "failed";
  } catch (e) {
    await markFailed(workerConn, job.id, e instanceof Error ? e.message : "worker_error").catch(() => {});
    return "failed";
  }
}

/**
 * ניסיון משלוח מיידי של ההתראה לבירור נתון, סמוך לתשובת הנציג (אחרי שנשמרה).
 * best-effort ולא-חוסם: אם ה-SMTP/הרשת נכשלים, המשימה נשארת pending והמתזמן
 * ישלח בהמשך. אינו זורק. דורש service role (worker connection).
 */
export async function sendForInquiryNow(inquiryId: string, opts?: { baseUrl?: string }): Promise<"sent" | "failed" | "skipped" | "no_job"> {
  const workerConn = notifierConn();
  if (!workerConn) return "no_job";
  const configured = mailConfigured();
  const baseUrl = (opts?.baseUrl ?? process.env.APP_BASE_URL ?? "").trim();
  try {
    const job = await claimJobByInquiry(workerConn, inquiryId);
    if (!job) return "no_job";
    return await sendOneJob(workerConn, job, baseUrl, configured);
  } catch {
    return "failed";
  }
}