-- supabase/migrations/0001_core_schema.sql
-- סכמת ליבה: תיקים, עובדות, תרחישים, השוואות, ריצות, הרשאות.
-- מקור הסכמה (schema of record). האילוצים נאכפים במסד, לא רק ב-UI.
-- design §3.1, §3.2; REQ-3.1, REQ-3.2, REQ-3.3.

-- הערה: הזהות (owner) מגיעה מ-auth.uid() בהרשאות רגילות. בסביבת הדגמה
-- המבודדת, ה-owner הוא מזהה ביקור (visit id) המוזרק מהשרת מתוך cookie httpOnly.
-- בשני המקרים ה-owner_id מוזרק מהשרת ולעולם לא מהלקוח.

create extension if not exists "pgcrypto";

-- גרסאות כללים (rule_sets) - מזוהות לפי content_hash, לא לפי version (design §2.1)
create table if not exists rule_sets (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  content_hash text not null unique,
  config jsonb not null,
  imported_at timestamptz not null default now()
);

-- גרסת נתונים (dataset) - snapshot בלתי משתנה
create table if not exists datasets (
  id uuid primary key default gen_random_uuid(),
  rule_set_id uuid not null references rule_sets(id),
  value_of_use_source text not null,
  value_of_use_row_count integer not null,
  imported_at timestamptz not null default now(),
  validation_report jsonb
);

-- רכבים בגרסת נתונים (כולל provenance לקוד סוג רכב)
create table if not exists vehicles (
  dataset_id uuid not null references datasets(id),
  catalog_code text not null,
  grp text not null,
  manufacturer_code text not null,
  model_code text not null,
  registration_year text not null,
  vehicle_type_code text not null,
  value_of_use numeric(12,2) not null,
  propulsion smallint not null,
  company_cost numeric(12,2) not null,
  default_participation numeric(12,2) not null,
  type_resolution_source text not null,
  primary key (dataset_id, catalog_code),
  constraint vehicle_type_resolution_not_empty check (length(type_resolution_source) > 0)
);

-- תיק (case) - בעלות + גרסת עובדות
create table if not exists cases (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  is_demo boolean not null default false,
  dataset_id uuid not null references datasets(id),
  status text not null default 'active',
  facts_revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_cases_owner_updated on cases(owner_id, updated_at);

-- עובדות התיק (ערכים משותפים המשפיעים על חישוב)
create table if not exists case_facts (
  case_id uuid primary key references cases(id) on delete cascade,
  occupation_code text,
  reported_group text,
  base_salary numeric(12,2),
  commission numeric(12,2),
  bonus numeric(12,2),
  pension_rate numeric(6,4),
  training_rate numeric(6,4),
  credit_points numeric(6,2),
  qualifying_children integer
);

-- תרחישים: baseline (היום) + alternatives (חלופות)
create table if not exists scenarios (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  role text not null,                 -- 'baseline' | 'alternative'
  route text not null,                -- 'company_car' | 'family' | 'waiver'
  vehicle_code text,
  participation numeric(12,2),
  maintenance_allowance numeric(12,2) not null default 0,
  revision integer not null default 0,
  fingerprint text,
  created_at timestamptz not null default now(),
  unique (case_id, id)
);
-- בדיוק baseline אחד לכל תיק פעיל (AC-3.1.2)
create unique index if not exists uniq_baseline_per_case
  on scenarios(case_id) where role = 'baseline';

-- הודעות (לשלב השיחה; נוצר כבר עכשיו לשחזור)
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  role text not null,
  seq integer not null,
  client_message_id text,
  content jsonb not null,
  created_at timestamptz not null default now(),
  unique (case_id, seq),
  unique (case_id, client_message_id)
);

-- ריצות (turn_runs) - מצב עיבוד ושחזור (REQ-3.4)
create table if not exists turn_runs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  message_id uuid,
  request_id text not null,
  actor_id text not null,
  operation text not null,
  status text not null,               -- running|completed|abandoned|retryable|failed
  input_facts_revision integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (actor_id, operation, request_id)   -- אידמפוטנטיות (AC-3.3.3/3.3.4)
);

-- השוואות שהושלמו - immutable (design §3.2)
create table if not exists comparisons (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  baseline_scenario_id uuid not null,
  alternative_scenario_id uuid not null,
  dataset_id uuid not null references datasets(id),
  rule_set_hash text not null,
  facts_revision integer not null,
  input_snapshot jsonb not null,
  result jsonb not null,
  request_id text,
  completed_at timestamptz not null default now(),
  foreign key (case_id, baseline_scenario_id) references scenarios(case_id, id),
  foreign key (case_id, alternative_scenario_id) references scenarios(case_id, id)
);
create index if not exists idx_comparisons_case_completed on comparisons(case_id, completed_at);

-- מניעת עדכון השוואה שהושלמה (immutable)
create or replace function forbid_comparison_update() returns trigger as $$
begin
  raise exception 'completed comparisons are immutable';
end;
$$ language plpgsql;
drop trigger if exists trg_comparisons_immutable on comparisons;
create trigger trg_comparisons_immutable
  before update on comparisons
  for each row execute function forbid_comparison_update();

-- staff roles - נכתב רק במנגנון ניהולי מורשה (design §8.3)
create table if not exists staff_roles (
  user_id text primary key,
  role text not null,
  active boolean not null default true,
  scope jsonb
);

-- ========== RLS ==========
-- בעלות נאכפת לפי owner_id. ב-Supabase: owner_id = auth.uid()::text.
-- user actions רצות תחת הקשר המשתמש; מפתח service-role (worker/admin) עוקף RLS
-- ומוגבל למודול נפרד בלבד (design §8.2).

alter table cases enable row level security;
alter table case_facts enable row level security;
alter table scenarios enable row level security;
alter table messages enable row level security;
alter table turn_runs enable row level security;
alter table comparisons enable row level security;

-- פוליסה: גישה רק לתיקים בבעלות המשתמש הנוכחי.
-- app.owner_id נקבע ע"י השרת לכל בקשה (set_config), ומייצג את auth.uid()
-- או את מזהה ביקור הדגמה. הלקוח לעולם אינו קובע אותו.
create policy cases_owner on cases
  using (owner_id = current_setting('app.owner_id', true));

create policy case_facts_owner on case_facts
  using (exists (select 1 from cases c where c.id = case_facts.case_id
    and c.owner_id = current_setting('app.owner_id', true)));

create policy scenarios_owner on scenarios
  using (exists (select 1 from cases c where c.id = scenarios.case_id
    and c.owner_id = current_setting('app.owner_id', true)));

create policy messages_owner on messages
  using (exists (select 1 from cases c where c.id = messages.case_id
    and c.owner_id = current_setting('app.owner_id', true)));

create policy turn_runs_owner on turn_runs
  using (exists (select 1 from cases c where c.id = turn_runs.case_id
    and c.owner_id = current_setting('app.owner_id', true)));

create policy comparisons_owner on comparisons
  using (exists (select 1 from cases c where c.id = comparisons.case_id
    and c.owner_id = current_setting('app.owner_id', true)));