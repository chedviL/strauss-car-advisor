-- supabase/migrations/0020_demo_rep_own_inquiries.sql
-- החלטת מוצר: מי ששלח פנייה לנציג יכול להיכנס להתנסות כנציג ולענות לעצמו, בלי שלב צירוף.
-- מתנסה (מי שלחץ על "התנסות כנציג") רואה ועונה על:
--   * פניות הדוגמה שנזרעו לו (seeded), ו-
--   * הפניות *שלו עצמו* (בעלות לפי app.owner_id = בעל התיק). לא של אף אחד אחר.
-- שאר ההגנות ללא שינוי: הצטרפות מפורשת, דגל שרת בשרת, בידוד בין משתמשים, בלי הרשאת נציג ארגונית.
-- פונקציות הצירוף הידני (0019) מיותרות ומוסרות. מיגרציה תוספתית; אין שינוי בנתונים.

drop function if exists demo_rep_attachable();
drop function if exists demo_rep_attach(uuid);
drop function if exists demo_rep_detach(uuid);

drop function if exists demo_rep_list_inquiries();
create function demo_rep_list_inquiries()
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
         case when cs.owner_id = demo_rep_current_user() then 'owned' else 'seeded' end
    from inquiries i
    join cases cs on cs.id = i.case_id
    left join scenarios sc on sc.id = i.scenario_id
    left join case_facts cf on cf.case_id = i.case_id
   where demo_rep_is_enrolled()
     and i.status in ('open', 'answered')
     and i.type in ('employee_participation', 'occupation_eligibility_clarification')
     and (
       cs.owner_id = demo_rep_current_user()
       or exists (select 1 from demo_inquiry_scope d
                   where d.inquiry_id = i.id and d.demo_user_id = demo_rep_current_user() and d.origin = 'seeded')
     )
   order by (case when i.status = 'open' then 0 else 1 end), i.created_at desc;
$$;

create or replace function demo_rep_inquiry_access(p_inquiry uuid)
returns table (owner_id text, origin text)
language sql stable security definer set search_path = public, pg_temp as $$
  select cs.owner_id,
         case when cs.owner_id = demo_rep_current_user() then 'owned' else 'seeded' end
    from inquiries i
    join cases cs on cs.id = i.case_id
   where i.id = p_inquiry
     and demo_rep_is_enrolled()
     and i.type in ('employee_participation', 'occupation_eligibility_clarification')
     and (
       cs.owner_id = demo_rep_current_user()
       or exists (select 1 from demo_inquiry_scope d
                   where d.inquiry_id = i.id and d.demo_user_id = demo_rep_current_user() and d.origin = 'seeded')
     );
$$;

revoke all on function demo_rep_list_inquiries() from public;
revoke all on function demo_rep_inquiry_access(uuid) from public;
grant execute on function demo_rep_list_inquiries() to strauss_app;
grant execute on function demo_rep_inquiry_access(uuid) to strauss_app;

do $$
declare r text; f text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach f in array array['demo_rep_list_inquiries()', 'demo_rep_inquiry_access(uuid)'] loop
        execute format('revoke all on function %s from %I', f, r);
      end loop;
    end if;
  end loop;
end $$;
