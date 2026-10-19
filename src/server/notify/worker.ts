// src/server/notify/worker.ts
// עיבוד תור ההתראות: תופס משימות שהגיע זמנן, מברר את המייל המאומת של הנמען
// (Supabase Admin, service role - המייל לא נשמר אצלנו), בונה תוכן ללא פרטים
// כספיים, שולח, ומסמן sent/failed. ניסיונות חוזרים: backoff מוכפל ב-claim.
// רץ בחיבור worker (service role) שאינו כפוף ל-RLS.

import { claimDueJobs, markSent, markFailed } from "./queue.js";
import { buildContent, caseLink } from "./content.js";
import { sendMail, mailConfigured } from "./mailer.js";

export interface WorkerResult { claimed: number; sent: number; failed: number; skipped: number; configured: boolean }

/** מברר מייל מאומת לפי מזהה משתמש דרך Supabase Admin. null אם אין/לא נמצא. */
async function lookupEmail(userId: string): Promise<string | null> {
  const url = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) return null;
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
  const workerConn = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  const configured = mailConfigured();
  if (!workerConn) return { claimed: 0, sent: 0, failed: 0, skipped: 0, configured };
  const baseUrl = (opts?.baseUrl ?? process.env.APP_BASE_URL ?? "").trim();

  const jobs = await claimDueJobs(workerConn, opts?.limit ?? 10);
  let sent = 0, failed = 0, skipped = 0;

  for (const job of jobs) {
    if (!configured) { await markFailed(workerConn, job.id, "mail_not_configured"); skipped++; continue; }
    try {
      const email = await lookupEmail(job.recipientUserId);
      if (!email) { await markFailed(workerConn, job.id, "recipient_email_not_found"); failed++; continue; }
      const link = caseLink(baseUrl || "", job.caseId);
      const content = buildContent(job.kind, link);
      const r = await sendMail({ to: email, subject: content.subject, text: content.text, html: content.html });
      if (r.ok) { await markSent(workerConn, job.id); sent++; }
      else { await markFailed(workerConn, job.id, r.error ?? "send_failed"); failed++; }
    } catch (e) {
      await markFailed(workerConn, job.id, e instanceof Error ? e.message : "worker_error").catch(() => {});
      failed++;
    }
  }
  return { claimed: jobs.length, sent, failed, skipped, configured };
}