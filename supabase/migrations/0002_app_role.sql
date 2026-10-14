-- supabase/migrations/0002_app_role.sql
-- תפקיד אפליקציה מוגבל הכפוף ל-RLS, נפרד מתפקיד המיגרציות/בעלים.
-- האפליקציה מתחברת כ-strauss_app; המיגרציות רצות כבעלים (postgres/owner).
-- strauss_app אינו superuser ואינו bypassrls => RLS חוסם אותו ברמת המסד.
--
-- סיסמה: אינה נכתבת במיגרציה (סוד). לאחר הרצת המיגרציות, הגדר סיסמה פעם אחת:
--   alter role strauss_app with password '...';   (ראו README, שלב הגדרת סיסמה)
-- ה-DATABASE_URL של האפליקציה יצביע על strauss_app; MIGRATION_DATABASE_URL על postgres.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'strauss_app') then
    -- LOGIN כדי שהאפליקציה תוכל להתחבר ישירות; NOINHERIT; ללא superuser/createdb/createrole.
    create role strauss_app login noinherit;
  else
    alter role strauss_app login noinherit;
  end if;
  -- אכיפה מפורשת: לא superuser, לא bypassrls, לא createrole/createdb.
  alter role strauss_app nosuperuser nobypassrls nocreatedb nocreaterole;
end$$;

-- הרשאות מינימליות: שימוש בסכמה + DML על טבלאות האפליקציה בלבד (ללא DDL).
grant usage on schema public to strauss_app;

grant select, insert, update, delete on
  cases, case_facts, scenarios, messages, turn_runs, comparisons
  to strauss_app;

-- קריאה בלבד על נתוני התצורה (נכתבים רק במסלול מיגרציה/אדמין).
grant select on rule_sets, datasets, vehicles, staff_roles to strauss_app;

-- רצף ה-UUID נוצר ב-gen_random_uuid(); אין צורך בהרשאת sequence.
-- אין grant על טבלאות עתידיות אוטומטית; ברירת המחדל היא deny.

-- אימות עצמי: strauss_app חייב להיות כפוף ל-RLS.
do $$
declare r record;
begin
  select rolbypassrls, rolsuper into r from pg_roles where rolname = 'strauss_app';
  if r.rolbypassrls then raise exception 'strauss_app must not have BYPASSRLS'; end if;
  if r.rolsuper then raise exception 'strauss_app must not be SUPERUSER'; end if;
end$$;