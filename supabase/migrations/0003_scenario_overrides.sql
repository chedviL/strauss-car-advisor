-- supabase/migrations/0003_scenario_overrides.sql
-- override היפותטי ברמת התרחיש (שדות שכר בלבד). ריק = ירושה מלאה מהעובדות.
alter table scenarios
  add column if not exists overrides jsonb not null default '{}'::jsonb;