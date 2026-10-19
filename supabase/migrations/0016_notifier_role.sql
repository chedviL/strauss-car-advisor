-- supabase/migrations/0016_notifier_role.sql
-- תפקיד worker מצומצם לעיבוד תור ההתראות, במקום שימוש בתפקיד הבעלים/מיגרציות
-- (service role / bypassrls) שנותן גישה כללית לכל תיקי העובדים. התפקיד הזה יכול
-- *אך ורק* לקרוא ולעדכן את notification_jobs - לתפוס משימה ולסמן sent/failed.
-- בירור כתובת המייל של הנמען נעשה דרך Supabase Admin API (לא דרך המסד), ולכן
-- התפקיד אינו זקוק לגישה ל-auth.users או לכל טבלת תיקים/הודעות/עובדות.
--
-- CRON_SECRET מגן על הנתיב ברמת ה-HTTP; הוא אינו מעניק הרשאות במסד. ההרשאה
-- במסד נאכפת כאן: strauss_notifier כפוף ל-RLS (אינו הבעלים, לא superuser,
-- לא bypassrls), ויש לו גישה לטבלה אחת בלבד.
--
-- סיסמה: אינה נכתבת במיגרציה (סוד). לאחר המיגרציות, כבעלים, מגדירים סיסמה
-- ומרכיבים NOTIFY_DATABASE_URL (ראו scripts/db/set-notifier-password.ts).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'strauss_notifier') then
    create role strauss_notifier login;
  else
    alter role strauss_notifier login;
  end if;
end$$;

-- גישה לסכמה בלבד; בלי DDL.
grant usage on schema public to strauss_notifier;

-- *רק* notification_jobs. SELECT לקריאת משימות שהגיע זמנן ולבירור הנמען (המזהה);
-- UPDATE מוגבל לעמודות הסטטוס/תזמון בלבד - אינו יכול לשנות נמען/תיק/בירור/סוג,
-- כך שאינו יכול להסיט מייל ליעד אחר או לזייף שיוך.
grant select on notification_jobs to strauss_notifier;
grant update (status, attempts, next_attempt_at, last_error, sent_at)
  on notification_jobs to strauss_notifier;

-- אין גישה לשום טבלה אחרת. במפורש *לא* מעניקים cases/case_facts/scenarios/
-- messages/turn_runs/comparisons/inquiries/vehicles/datasets/rule_sets/staff_roles.

-- פוליסת RLS ל-worker: מותר לעבד את כל שורות notification_jobs (זהו worker
-- מהימן לתור), אך רק בטבלה הזו - ואין לו grants על טבלאות אחרות כדי "לקפוץ"
-- דרך FK. מופרד מפוליסות הבעלים (שמבוססות על app.owner_id) ומוגבל TO התפקיד.
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'notification_jobs' and policyname = 'notif_worker_process') then
    create policy notif_worker_process on notification_jobs
      for all
      to strauss_notifier
      using (true)
      with check (true);
  end if;
end $$;

-- אימות עצמי: strauss_notifier חייב להיות כפוף ל-RLS (לא superuser, לא bypassrls).
do $$
declare r record;
begin
  select rolbypassrls, rolsuper into r from pg_roles where rolname = 'strauss_notifier';
  if r.rolbypassrls then raise exception 'strauss_notifier must not have BYPASSRLS'; end if;
  if r.rolsuper then raise exception 'strauss_notifier must not be SUPERUSER'; end if;
end$$;
