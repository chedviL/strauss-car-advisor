-- supabase/migrations/0006_regrant_config_read.sql
-- מוודא שתפקיד האפליקציה יכול לקרוא את טבלאות התצורה (datasets/vehicles/rule_sets).
-- idempotent; מתקן מצב שבו grant קודם לא נתפס.
grant usage on schema public to strauss_app;
grant select on rule_sets, datasets, vehicles, staff_roles to strauss_app;