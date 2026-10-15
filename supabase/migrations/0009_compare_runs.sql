-- supabase/migrations/0009_compare_runs.sql
-- שמירת תוצאת השוואה גמישה מלאה (discover/explicit) לשליפה לפי מזהה בהמשך
-- ("מה במקום השישי?", "תראה את כולן", "למה דווקא זה?") בלי חישוב מחדש.
-- התוצאה המלאה נשמרת כאן; למודל מוחזרת תמצית בלבד.
create table if not exists compare_runs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  facts_revision integer not null,
  rule_set_hash text not null,
  mode text not null,                 -- 'discover' | 'explicit'
  ranking text not null default 'net_delta_desc',
  result jsonb not null,              -- CompareResult המלא (כולל breakdown לכל חלופה)
  created_at timestamptz not null default now()
);
create index if not exists idx_compare_runs_case on compare_runs(case_id, created_at desc);

alter table compare_runs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='compare_runs' and policyname='compare_runs_owner') then
    create policy compare_runs_owner on compare_runs
      using (exists (select 1 from cases c where c.id = compare_runs.case_id
        and c.owner_id = current_setting('app.owner_id', true)))
      with check (exists (select 1 from cases c where c.id = compare_runs.case_id
        and c.owner_id = current_setting('app.owner_id', true)));
  end if;
end $$;
grant select, insert on compare_runs to strauss_app;