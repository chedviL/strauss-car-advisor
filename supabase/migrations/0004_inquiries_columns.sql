-- supabase/migrations/0004_inquiries_columns.sql
-- עמודות לפניות נציג התואמות ל-openInquiry (dedup לפי type + context_fingerprint).
create table if not exists inquiries (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  scenario_id uuid,
  type text not null,
  context_fingerprint text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);
alter table inquiries enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='inquiries' and policyname='inquiries_owner') then
    create policy inquiries_owner on inquiries
      using (exists (select 1 from cases c where c.id = inquiries.case_id
        and c.owner_id = current_setting('app.owner_id', true)));
  end if;
end $$;
-- dedup: פנייה פתוחה אחת לכל (case, type, fingerprint)
create unique index if not exists uniq_open_inquiry
  on inquiries(case_id, type, context_fingerprint) where status = 'open';
grant select, insert, update on inquiries to strauss_app;