-- supabase/migrations/0013_payslip_extraction.sql
-- שמירת תוצאת החילוץ על שורת ההעלאה, לשחזור אחרי רענון (חילוץ שממתין לאישור)
-- ולמניעת החלה כפולה (applied_at). storage_backend מתעד היכן נשמר הקובץ:
-- 'local' (דיסק שרת) או 'supabase' (Storage) - לתמיכה בפריסה.
alter table payslip_uploads add column if not exists extraction jsonb;
alter table payslip_uploads add column if not exists applied_at timestamptz;
alter table payslip_uploads add column if not exists storage_backend text not null default 'local';