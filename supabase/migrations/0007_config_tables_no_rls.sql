-- supabase/migrations/0007_config_tables_no_rls.sql
-- טבלאות התצורה (rule_sets/datasets/vehicles) אינן owner-scoped - הן נתוני מערכת
-- משותפים שהאפליקציה קוראת. מוודאים שאין עליהן RLS (שהיה מסתיר שורות מתפקיד
-- האפליקציה שאינו הבעלים). staff_roles נשאר מוגן בנפרד (אדמין בלבד).
alter table rule_sets disable row level security;
alter table datasets  disable row level security;
alter table vehicles  disable row level security;
-- הרשאת קריאה (idempotent).
grant select on rule_sets, datasets, vehicles to strauss_app;