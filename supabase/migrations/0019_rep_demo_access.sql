-- supabase/migrations/0019_rep_demo_access.sql
-- גישת התנסות כנציג להדגמה (מוגבלת). מיגרציה תוספתית: לא משנה ולא מוחקת נתונים קיימים.
--
-- עקרונות:
--  * אין כאן הרשאת נציג ארגונית. staff_roles ללא שינוי ונכתב רק בערוץ ניהולי.
--  * מתנסה רואה ועונה *רק* על פניות ששויכו במפורש להיקף ההדגמה שלו (demo_inquiry_scope):
--      seeded = פניות פיקטיביות שנזרעו עבורו (בעלים סינתטי 'demo-seed:<userId>', בלי מייל);
--      owned  = פנייה של המשתמש עצמו שהוא צירף במפורש (בעלות נבדקת כאן, ב-DB).
--  * שתי הטבלאות חדשות נעולות: RLS מופעל ואין גרנט לתפקיד האפליקציה. הגישה רק דרך
--    פונקציות SECURITY DEFINER צרות שגוזרות את הזהות מ-app.owner_id (נקבע בשרת).
--  * דגל ההפעלה (REP_DEMO_ACCESS_ENABLED) נאכף בשרת האפליקציה בכל פעולת הדגמה.
--  * פניות seeded מוחרגות מהפונקציות של נציגים רגילים (rep_list_inquiries / rep_inquiry_owner).

create table if not exists rep_demo_access (
  user_id text primary key,
  enrolled_at timestamptz not null default now()
);

create table if not exists demo_inquiry_scope (
  inquiry_id uuid primary key references inquiries(id) on delete cascade,
  demo_user_id text not null,
  origin text not null check (origin in ('seeded', 'owned')),
  seed_key text,
  created_at timestamptz not null default now(),
  constraint demo_scope_seed_key_check check ((origin = 'seeded') = (seed_key is not null))
);
-- זריעה אידמפוטנטית: מפתח זריעה אחד לכל משתמש.
create unique index if not exists uniq_demo_seed_per_user
  on demo_inquiry_scope(demo_user_id, seed_key) where seed_key is not null;
create index if not exists idx_demo_scope_user on demo_inquiry_scope(demo_user_id);

alter table rep_demo_access enable row level security;
alter table demo_inquiry_scope enable row level security;
-- בכוונה בלי policies ובלי GRANT לתפקיד האפליקציה: הבעלים (פונקציות SECURITY DEFINER) בלבד.

-- ---------- עזר: זהות נוכחית ----------
create or replace function demo_rep_current_user() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select nullif(current_setting('app.owner_id', true), '');
$$;

create or replace function demo_rep_is_enrolled() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from rep_demo_access a where a.user_id = demo_rep_current_user());
$$;

-- ---------- הצטרפות להתנסות (idempotent) ----------
create or replace function demo_rep_enroll() returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me text := demo_rep_current_user();
begin
  if me is null then raise exception 'no identity'; end if;
  insert into rep_demo_access(user_id) values (me) on conflict do nothing;
  return true;
end;
$$;

-- ---------- רשימת פניות ההדגמה של המתנסה (אותה הקרנה מצומצמת כמו rep_list_inquiries) ----------
create or replace function demo_rep_list_inquiries()
returns table (
  inquiry_id uuid, case_id uuid, inq_type text, inq_status text, context_fingerprint text,
  created_at timestamptz, answer_value numeric, answer_note text, effective_from date,
  answered_at timestamptz, scenario_id uuid, facts_revision integer, case_updated_at timestamptz,
  scenario_role text, route text, vehicle_code text, participation numeric, reported_group text,
  origin text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select i.id, i.case_id, i.type, i.status, i.context_fingerprint,
         i.created_at, i.answer_value, i.answer_note, i.effective_from,
         i.answered_at, i.scenario_id, cs.facts_revision, cs.updated_at,
         sc.role, sc.route, sc.vehicle_code, sc.participation, cf.reported_group,
         d.origin
    from demo_inquiry_scope d
    join inquiries i on i.id = d.inquiry_id
    join cases cs on cs.id = i.case_id
    left join scenarios sc on sc.id = i.scenario_id
    left join case_facts cf on cf.case_id = i.case_id
   where d.demo_user_id = demo_rep_current_user()
     and demo_rep_is_enrolled()
     and i.status in ('open', 'answered')
     and i.type in ('employee_participation', 'occupation_eligibility_clarification')
   order by (case when i.status = 'open' then 0 else 1 end), i.created_at desc;
$$;

-- ---------- גישה לפנייה לצורך מענה: בעל התיק + מקור; null אם מחוץ להיקף ההדגמה ----------
create or replace function demo_rep_inquiry_access(p_inquiry uuid)
returns table (owner_id text, origin text)
language sql stable security definer set search_path = public, pg_temp as $$
  select cs.owner_id, d.origin
    from demo_inquiry_scope d
    join inquiries i on i.id = d.inquiry_id
    join cases cs on cs.id = i.case_id
   where d.inquiry_id = p_inquiry
     and d.demo_user_id = demo_rep_current_user()
     and demo_rep_is_enrolled()
     and i.type in ('employee_participation', 'occupation_eligibility_clarification');
$$;

-- ---------- פניות של המשתמש עצמו שאפשר לצרף להדגמה ----------
create or replace function demo_rep_attachable()
returns table (inquiry_id uuid, case_id uuid, inq_type text, created_at timestamptz,
               scenario_role text, route text, vehicle_code text)
language sql stable security definer set search_path = public, pg_temp as $$
  select i.id, i.case_id, i.type, i.created_at, sc.role, sc.route, sc.vehicle_code
    from inquiries i
    join cases cs on cs.id = i.case_id
    left join scenarios sc on sc.id = i.scenario_id
   where cs.owner_id = demo_rep_current_user()
     and demo_rep_is_enrolled()
     and i.status = 'open'
     and i.type in ('employee_participation', 'occupation_eligibility_clarification')
     and not exists (select 1 from demo_inquiry_scope d where d.inquiry_id = i.id)
   order by i.created_at desc;
$$;

-- ---------- צירוף מפורש של פנייה *בבעלות המשתמש* להדגמה ----------
create or replace function demo_rep_attach(p_inquiry uuid) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me text := demo_rep_current_user();
begin
  if me is null or not demo_rep_is_enrolled() then return false; end if;
  -- בעלות נבדקת כאן: התיק חייב להיות של המשתמש המאומת; סוג מוכר בלבד.
  if not exists (
    select 1 from inquiries i join cases cs on cs.id = i.case_id
     where i.id = p_inquiry and cs.owner_id = me
       and i.type in ('employee_participation', 'occupation_eligibility_clarification')
  ) then return false; end if;
  insert into demo_inquiry_scope(inquiry_id, demo_user_id, origin)
  values (p_inquiry, me, 'owned') on conflict (inquiry_id) do nothing;
  return exists (select 1 from demo_inquiry_scope d where d.inquiry_id = p_inquiry and d.demo_user_id = me);
end;
$$;

create or replace function demo_rep_detach(p_inquiry uuid) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  delete from demo_inquiry_scope
   where inquiry_id = p_inquiry and demo_user_id = demo_rep_current_user() and origin = 'owned';
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- ---------- זריעה: מפתחות שכבר נזרעו, ורישום פנייה שנזרעה (רק מתוך מרחב הבעלים הסינתטי) ----------
create or replace function demo_rep_seeded_keys() returns setof text
language sql stable security definer set search_path = public, pg_temp as $$
  select d.seed_key from demo_inquiry_scope d
   where d.demo_user_id = demo_rep_current_user() and d.origin = 'seeded' and demo_rep_is_enrolled();
$$;

create or replace function demo_rep_register_seed(p_inquiry uuid, p_seed_key text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me text := demo_rep_current_user(); n integer;
begin
  if me is null or not demo_rep_is_enrolled() or p_seed_key is null or p_seed_key = '' then return false; end if;
  -- רק פנייה בתיק של הבעלים הסינתטי של *אותו* משתמש; אי אפשר "לזרוע" תיק של אחר.
  if not exists (
    select 1 from inquiries i join cases cs on cs.id = i.case_id
     where i.id = p_inquiry and cs.owner_id = 'demo-seed:' || me
  ) then return false; end if;
  insert into demo_inquiry_scope(inquiry_id, demo_user_id, origin, seed_key)
  values (p_inquiry, me, 'seeded', p_seed_key) on conflict do nothing;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- ---------- נציגים רגילים אינם רואים/עונים על פניות seeded (נתוני תצוגה בלבד) ----------
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
     and not exists (select 1 from demo_inquiry_scope d where d.inquiry_id = i.id and d.origin = 'seeded')
   order by (case when i.status = 'open' then 0 else 1 end), i.created_at desc;
$$;

create or replace function rep_inquiry_owner(p_inquiry uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select cs.owner_id
    from inquiries i
    join cases cs on cs.id = i.case_id
   where i.id = p_inquiry
     and i.type = any (staff_inquiry_types())
     and not exists (select 1 from demo_inquiry_scope d where d.inquiry_id = i.id and d.origin = 'seeded');
$$;

-- ---------- גרנטים: EXECUTE לתפקיד האפליקציה בלבד ----------
revoke all on function demo_rep_current_user() from public;
revoke all on function demo_rep_is_enrolled() from public;
revoke all on function demo_rep_enroll() from public;
revoke all on function demo_rep_list_inquiries() from public;
revoke all on function demo_rep_inquiry_access(uuid) from public;
revoke all on function demo_rep_attachable() from public;
revoke all on function demo_rep_attach(uuid) from public;
revoke all on function demo_rep_detach(uuid) from public;
revoke all on function demo_rep_seeded_keys() from public;
revoke all on function demo_rep_register_seed(uuid, text) from public;
revoke all on function rep_list_inquiries() from public;
revoke all on function rep_inquiry_owner(uuid) from public;

grant execute on function demo_rep_is_enrolled() to strauss_app;
grant execute on function demo_rep_enroll() to strauss_app;
grant execute on function demo_rep_list_inquiries() to strauss_app;
grant execute on function demo_rep_inquiry_access(uuid) to strauss_app;
grant execute on function demo_rep_attachable() to strauss_app;
grant execute on function demo_rep_attach(uuid) to strauss_app;
grant execute on function demo_rep_detach(uuid) to strauss_app;
grant execute on function demo_rep_seeded_keys() to strauss_app;
grant execute on function demo_rep_register_seed(uuid, text) to strauss_app;
grant execute on function rep_list_inquiries() to strauss_app;
grant execute on function rep_inquiry_owner(uuid) to strauss_app;
-- demo_rep_current_user נשאר פנימי (הפונקציות האחרות רצות כבעלים וקוראות לו).

-- ב-Supabase תפקידי PostgREST (anon/authenticated) מקבלים EXECUTE כברירת מחדל על פונקציות חדשות.
-- מבטלים אותם במפורש (אם קיימים): הפונקציות נועדו לתפקיד האפליקציה בלבד.
do $$
declare r text; f text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach f in array array[
        'demo_rep_current_user()', 'demo_rep_is_enrolled()', 'demo_rep_enroll()',
        'demo_rep_list_inquiries()', 'demo_rep_inquiry_access(uuid)', 'demo_rep_attachable()',
        'demo_rep_attach(uuid)', 'demo_rep_detach(uuid)', 'demo_rep_seeded_keys()',
        'demo_rep_register_seed(uuid, text)'
      ] loop
        execute format('revoke all on function %s from %I', f, r);
      end loop;
    end if;
  end loop;
end $$;
