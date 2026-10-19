-- supabase/migrations/0015_notification_jobs.sql
-- תור משלוח התראות עמיד (durable). משימת ההתראה נוצרת *באותה טרנזקציה* של תשובת
-- הנציג, כך שכשל מייל אינו מבטל תשובה/חישוב שכבר נשמרו, והיא שורדת קריסה/פריסה.
--
-- פרטיות: השורה אינה מכילה שכר, נתוני תלוש, סכומים או כתובת מייל. היא מחזיקה רק
-- את מזהה הנמען (recipient = owner_id = מזהה Supabase Auth) ואת מזהי הבירור/התיק.
-- ה-worker מברר את כתובת המייל המאומתת לפי המזהה בזמן השליחה (service role),
-- ולכן המייל עצמו אינו נשמר אצלנו.
--
-- kind:
--   comparison_ready - נשלח רק כשהתשובה הוחלה וההשוואה חושבה מחדש בפועל.
--   answer_recorded  - תשובת נציג נרשמה אך טרם הוחלה (הקשר מיושן/תחולה עתידית/הערה).
--                      לעולם לא טוען "ההשוואה מוכנה".

create table if not exists notification_jobs (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id text not null,          -- owner_id של בעל/ת הבירור (auth.uid()::text)
  case_id uuid not null references cases(id) on delete cascade,
  inquiry_id uuid references inquiries(id) on delete cascade,
  kind text not null check (kind in ('comparison_ready', 'answer_recorded')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  last_error text,                          -- הודעת שגיאה מקוצרת לתפעול (ללא סודות)
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- מניעת כפילויות: לכל (בירור, סוג) משימה אחת בלבד. ניסיון חוזר לשמור אותה
-- תשובה (אותו inquiry) לא יוצר משלוח שני. (ON CONFLICT DO NOTHING בקוד.)
create unique index if not exists uniq_notification_inquiry_kind
  on notification_jobs(inquiry_id, kind) where inquiry_id is not null;

-- אינדקס לבורר ה-worker: המשימות הממתינות שהגיע זמנן.
create index if not exists idx_notification_due
  on notification_jobs(status, next_attempt_at) where status = 'pending';

alter table notification_jobs enable row level security;

-- הבעלים רואה את ההתראות של עצמו בלבד (לשחזור/חיווי). אינו כותב/מוחק.
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'notification_jobs' and policyname = 'notif_owner_read') then
    create policy notif_owner_read on notification_jobs for select
      using (recipient_user_id = current_setting('app.owner_id', true));
  end if;
end $$;

-- תפקיד האפליקציה: יוצר משימות (INSERT) בתוך טרנזקציית התשובה (בהקשר הבעלים,
-- ולכן WITH CHECK מאפשר שורה שבה recipient = app.owner_id). קריאה לפי RLS.
-- *אינו* רשאי UPDATE/DELETE: עדכון סטטוס/ניסיונות נעשה ע"י ה-worker (service role),
-- שאינו כפוף ל-RLS, כדי שלא יהיה ניתן לזייף סטטוס "נשלח".
grant select, insert on notification_jobs to strauss_app;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'notification_jobs' and policyname = 'notif_owner_insert') then
    create policy notif_owner_insert on notification_jobs for insert
      with check (recipient_user_id = current_setting('app.owner_id', true));
  end if;
end $$;