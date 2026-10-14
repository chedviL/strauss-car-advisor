-- supabase/migrations/0002_app_role.sql
-- תפקיד אפליקציה מוגבל הכפוף ל-RLS, נפרד מתפקיד המיגרציות/בעלים.
-- האפליקציה מתחברת כ-strauss_app; המיגרציות רצות כבעלים (owner/postgres).
-- strauss_app אינו bypassrls ואין לו הרשאות DDL - RLS חוסם אותו ברמת המסד.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'strauss_app') then
    -- NOLOGIN כברירת מחדל; ב-Supabase מגדירים סיסמה/הרשאת login בנפרד
    -- דרך הקונסול או alter role. התפקיד במפורש אינו superuser ואינו bypassrls.
    create role strauss_app nologin noinherit;
  end if;
end$$;

-- הרשאות מינימליות: שימוש בסכמה + DML על טבלאות האפליקציה בלבד (ללא DDL).
grant usage on schema public to strauss_app;

grant select, insert, update, delete on
  cases, case_facts, scenarios, messages, turn_runs, comparisons
  to strauss_app;

-- קריאה בלבד על נתוני התצורה (נכתבים רק במסלול מיגרציה/אדמין).
grant select on rule_sets, datasets, vehicles, staff_roles to strauss_app;

-- אין grant על עתידיות אוטומטית; ברירת המחדל היא deny.
-- אין להעניק BYPASSRLS. RLS מופעל על טבלאות התיק (ראו 0001).

-- אימות עצמי: strauss_app אינו רשאי לעקוף RLS.
do $$
declare
  can_bypass boolean;
begin
  select rolbypassrls into can_bypass from pg_roles where rolname = 'strauss_app';
  if can_bypass then
    raise exception 'strauss_app must not have BYPASSRLS';
  end if;
end$$;