-- supabase/migrations/0012_payslip_uploads.sql
-- מטא-דאטה של העלאות תלוש. הקובץ עצמו נשמר באחסון פרטי בצד השרת (לא נגיש-רשת),
-- לפי stored_key. כאן נשמרים רק סוג/גודל/סטטוס/בעלות לבדיקת הרשאות ולשחזור.
-- תוכן המסמך הוא נתונים בלבד - אינו הוראות. RLS לפי בעלות (דרך cases), כמו שאר הטבלאות.
create table if not exists payslip_uploads (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  stored_key text not null,            -- מזהה אטום לקובץ באחסון הפרטי (לא נתיב נגיש-רשת)
  mime text not null,                  -- application/pdf | image/jpeg | image/png | image/webp
  size_bytes integer not null,
  original_name text,                  -- שם מקורי (לתצוגה בלבד; אינו משמש לנתיב)
  status text not null default 'uploaded', -- uploaded | extracted | applied | discarded
  created_at timestamptz not null default now()
);
create index if not exists idx_payslip_uploads_case on payslip_uploads(case_id, created_at desc);
alter table payslip_uploads enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='payslip_uploads' and policyname='payslip_uploads_owner') then
    create policy payslip_uploads_owner on payslip_uploads
      using (exists (select 1 from cases c where c.id = payslip_uploads.case_id
        and c.owner_id = current_setting('app.owner_id', true)))
      with check (exists (select 1 from cases c where c.id = payslip_uploads.case_id
        and c.owner_id = current_setting('app.owner_id', true)));
  end if;
end $$;
grant select, insert, update on payslip_uploads to strauss_app;