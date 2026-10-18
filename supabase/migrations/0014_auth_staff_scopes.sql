-- supabase/migrations/0014_auth_staff_scopes.sql
-- חתך התחברות והרשאות: owner_id הוא כעת מזהה משתמש Supabase Auth (uuid כטקסט),
-- ולא מזהה ביקור. הטבלאות הקיימות כבר מסננות לפי app.owner_id ולכן אינן משתנות.
--
-- כאן: (1) נעילת staff_roles - משתמש קורא רק את השורה של עצמו, ואינו יכול לכתוב.
-- (2) הרשאות נציג דרך פונקציות SECURITY DEFINER בלבד, deny-by-default, לפי
--     תפקיד פעיל + היקף סוגי פניות. הנציג אינו מקבל גישת SELECT לטבלאות המשתמשים.
-- (3) audit: מי ענה על הפנייה.
-- תפקידים מוענקים רק בערוץ ניהולי (בעלים/SQL editor) - ראו docs/auth-setup.md.

alter table staff_roles add column if not exists granted_at timestamptz not null default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'staff_roles_role_check') then
    alter table staff_roles add constraint staff_roles_role_check check (role in ('representative'));
  end if;
end $$;

-- RLS: משתמש רואה אך ורק את שורת התפקיד של עצמו (לצורך הצגה/שער UI).
alter table staff_roles enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'staff_roles' and policyname = 'staff_roles_self_read') then
    create policy staff_roles_self_read on staff_roles for select
      using (user_id = current_setting('app.owner_id', true));
  end if;
end $$;
-- הגנה בעומק: תפקיד האפליקציה לעולם אינו כותב ל-staff_roles.
revoke insert, update, delete on staff_roles from strauss_app;

alter table inquiries add column if not exists answered_by text;

-- סוגי הפניות שהמשתמש הנוכחי (app.owner_id) מורשה לטפל בהן. ריק = אין הרשאה.
create or replace function staff_inquiry_types() returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select array(select jsonb_array_elements_text(s.scope -> 'inquiryTypes'))
       from staff_roles s
      where s.user_id = current_setting('app.owner_id', true)
        and s.active
        and s.role = 'representative'
        and jsonb_typeof(s.scope -> 'inquiryTypes') = 'array'),
    '{}'::text[]);
$$;

-- רשימת פניות בהיקף הנציג, עם הקשר מצומצם בלבד: אין שכר, נטו, מייל או בעלים.
create or replace function rep_list_inquiries()
returns table (
  inquiry_id uuid, case_id uuid, inq_type text, inq_status text, context_fingerprint text,
  created_at timestamptz, answer_value numeric, answer_note text, effective_from date,
  answered_at timestamptz, scenario_id uuid, facts_revision integer, case_updated_at timestamptz,
  scenario_role text, route text, vehicle_code text, participation numeric, reported_group text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select i.id, i.case_id, i.type, i.status, i.context_fingerprint,
         i.created_at, i.answer_value, i.answer_note, i.effective_from,
         i.answered_at, i.scenario_id, cs.facts_revision, cs.updated_at,
         sc.role, sc.route, sc.vehicle_code, sc.participation, cf.reported_group
    from inquiries i
    join cases cs on cs.id = i.case_id
    left join scenarios sc on sc.id = i.scenario_id
    left join case_facts cf on cf.case_id = i.case_id
   where i.status in ('open', 'answered')
     and i.type = any (staff_inquiry_types())
   order by (case when i.status = 'open' then 0 else 1 end), i.created_at desc;
$$;

-- בעל התיק של פנייה, רק אם הנציג מורשה לסוג הפנייה. אחרת null (בלי לחשוף קיום).
create or replace function rep_inquiry_owner(p_inquiry uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select cs.owner_id
    from inquiries i
    join cases cs on cs.id = i.case_id
   where i.id = p_inquiry
     and i.type = any (staff_inquiry_types());
$$;

revoke all on function staff_inquiry_types() from public;
revoke all on function rep_list_inquiries() from public;
revoke all on function rep_inquiry_owner(uuid) from public;
grant execute on function staff_inquiry_types() to strauss_app;
grant execute on function rep_list_inquiries() to strauss_app;
grant execute on function rep_inquiry_owner(uuid) to strauss_app;