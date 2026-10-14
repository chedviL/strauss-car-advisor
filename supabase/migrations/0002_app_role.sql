-- supabase/migrations/0002_app_role.sql
-- תפקיד אפליקציה מוגבל הכפוף ל-RLS, נפרד מתפקיד המיגרציות/בעלים.
-- האפליקציה מתחברת כ-strauss_app; המיגרציות רצות כבעלים (postgres).
--
-- הערה ל-Supabase: ה-postgres המנוהל אינו superuser, ולכן אינו רשאי להריץ
-- ALTER ROLE ... NOSUPERUSER/NOBYPASSRLS. אין בכך צורך: תפקיד חדש נוצר כברירת
-- מחדל ללא superuser וללא bypassrls. אנו רק יוצרים את התפקיד כ-LOGIN ומעניקים
-- הרשאות DML מינימליות. RLS חל עליו כי הוא אינו הבעלים של הטבלאות.
--
-- סיסמה: אינה נכתבת במיגרציה (סוד). לאחר המיגרציות, כבעלים:
--   alter role strauss_app with password '...';  (ראו docs/supabase-setup.md)

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'strauss_app') then
    create role strauss_app login;
  else
    -- מוודאים LOGIN; לא נוגעים בתכונות superuser/bypassrls (ברירת מחדל: כבויות).
    alter role strauss_app login;
  end if;
end$$;

-- הרשאות מינימליות: שימוש בסכמה + DML על טבלאות האפליקציה בלבד (ללא DDL).
grant usage on schema public to strauss_app;

grant select, insert, update, delete on
  cases, case_facts, scenarios, messages, turn_runs, comparisons
  to strauss_app;

-- קריאה בלבד על נתוני התצורה (נכתבים רק במסלול מיגרציה/אדמין).
grant select on rule_sets, datasets, vehicles, staff_roles to strauss_app;

-- אימות עצמי: strauss_app חייב להיות כפוף ל-RLS (לא superuser, לא bypassrls).
-- אם מסיבה כלשהי התכונות דלוקות - נכשל במפורש.
do $$
declare r record;
begin
  select rolbypassrls, rolsuper into r from pg_roles where rolname = 'strauss_app';
  if r.rolbypassrls then raise exception 'strauss_app must not have BYPASSRLS'; end if;
  if r.rolsuper then raise exception 'strauss_app must not be SUPERUSER'; end if;
end$$;