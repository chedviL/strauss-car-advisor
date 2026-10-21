// src/server/notify/queue.ts
// תור ההתראות העמיד. ההוספה (enqueue) רצה בהקשר הבעלים (RLS, WITH CHECK על
// recipient=app.owner_id) כדי להיכתב יחד עם רישום התשובה. עיבוד השליחה (claim/
// mark) רץ בחיבור ה-worker (service role) שאינו כפוף ל-RLS, כדי שסטטוס "נשלח"
// לא ניתן לזיוף ע"י תפקיד האפליקציה.

import { withClient } from "../repositories/pg-pool.js";
import type { NotifyKind } from "./content.js";

/** מוסיף משימת התראה בהקשר הבעלים. idempotent: (inquiry_id, kind) ייחודי. */
export async function enqueueNotification(
  appConnection: string,
  ownerId: string,
  job: { caseId: string; inquiryId: string; kind: NotifyKind },
): Promise<void> {
  await withClient(appConnection, async (c) => {
    // set_config(local=true) דורש טרנזקציה פעילה; בלי begin/commit ההגדרה לא
    // חלה ו-RLS חוסם את ה-INSERT. לכן עוטפים בטרנזקציה מפורשת.
    await c.query("begin");
    try {
      await c.query("select set_config('app.owner_id', $1, true)", [ownerId]);
      await c.query(
        `insert into notification_jobs (recipient_user_id, case_id, inquiry_id, kind)
         values ($1, $2, $3, $4)
         on conflict (inquiry_id, kind) where inquiry_id is not null do nothing`,
        [ownerId, job.caseId, job.inquiryId, job.kind],
      );
      await c.query("commit");
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    }
  });
}

export interface DueJob {
  id: string;
  recipientUserId: string;
  caseId: string;
  inquiryId: string | null;
  kind: NotifyKind;
  attempts: number;
  maxAttempts: number;
}

/**
 * תופס עד limit משימות שהגיע זמנן, ומסמן אותן "בטיפול" ע"י דחיית next_attempt_at
 * והגדלת attempts באותה שאילתה (FOR UPDATE SKIP LOCKED) - כך שתי ריצות worker
 * מקבילות לא יתפסו את אותה משימה ולא יישלח מייל כפול.
 * רץ בחיבור ה-worker (service role).
 */
export async function claimDueJobs(workerConnection: string, limit = 10): Promise<DueJob[]> {
  return withClient(workerConnection, async (c) => {
    const r = await c.query(
      `with due as (
         select id from notification_jobs
          where status = 'pending' and next_attempt_at <= now()
          order by next_attempt_at
          for update skip locked
          limit $1
       )
       update notification_jobs n
          set attempts = n.attempts + 1,
              next_attempt_at = now() + (interval '1 minute' * power(2, least(n.attempts, 6)))
         from due
        where n.id = due.id
       returning n.id, n.recipient_user_id, n.case_id, n.inquiry_id, n.kind, n.attempts, n.max_attempts`,
      [limit],
    );
    return r.rows.map((x) => ({
      id: x.id as string,
      recipientUserId: x.recipient_user_id as string,
      caseId: x.case_id as string,
      inquiryId: (x.inquiry_id as string) ?? null,
      kind: x.kind as NotifyKind,
      attempts: x.attempts as number,
      maxAttempts: x.max_attempts as number,
    }));
  });
}

/**
 * תופס משימה בודדת של בירור+סוג אם היא ממתינה והגיע זמנה (למשלוח מיידי סמוך
 * לתשובה). אותה סמנטיקה כמו claimDueJobs: מגדיל attempts ודוחה next_attempt_at,
 * עם FOR UPDATE SKIP LOCKED כדי שלא יתנגש עם מתזמן שרץ במקביל. מחזיר null אם
 * אין משימה מתאימה או שכבר נתפסה. רץ בחיבור worker (service role).
 */
export async function claimJobByInquiry(workerConnection: string, inquiryId: string): Promise<DueJob | null> {
  return withClient(workerConnection, async (c) => {
    const r = await c.query(
      `with due as (
         select id from notification_jobs
          where inquiry_id = $1 and status = 'pending' and next_attempt_at <= now()
          order by next_attempt_at
          for update skip locked
          limit 1
       )
       update notification_jobs n
          set attempts = n.attempts + 1,
              next_attempt_at = now() + (interval '1 minute' * power(2, least(n.attempts, 6)))
         from due
        where n.id = due.id
       returning n.id, n.recipient_user_id, n.case_id, n.inquiry_id, n.kind, n.attempts, n.max_attempts`,
      [inquiryId],
    );
    if (r.rowCount === 0) return null;
    const x = r.rows[0];
    return {
      id: x.id as string, recipientUserId: x.recipient_user_id as string,
      caseId: x.case_id as string, inquiryId: (x.inquiry_id as string) ?? null,
      kind: x.kind as NotifyKind, attempts: x.attempts as number, maxAttempts: x.max_attempts as number,
    };
  });
}

export async function markSent(workerConnection: string, id: string): Promise<void> {
  await withClient(workerConnection, async (c) => {
    await c.query("update notification_jobs set status = 'sent', sent_at = now(), last_error = null where id = $1", [id]);
  });
}

/**
 * מסמן כשל: אם מיצינו את הניסיונות -> failed (לא יישלח שוב, גלוי לתפעול);
 * אחרת נשאר pending וינוסה שוב בניסיון הבא (next_attempt_at כבר נדחה ב-claim).
 */
export async function markFailed(workerConnection: string, id: string, error: string): Promise<void> {
  await withClient(workerConnection, async (c) => {
    await c.query(
      `update notification_jobs
          set last_error = $2,
              status = case when attempts >= max_attempts then 'failed' else 'pending' end
        where id = $1 and status = 'pending'`,
      [id, error.slice(0, 300)],
    );
  });
}