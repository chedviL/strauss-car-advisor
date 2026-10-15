-- supabase/migrations/0010_pending_request.sql
-- ייצוג עמיד של "בקשה פעילה שממתינה לנתונים" (למשל בקשת השוואה שנעצרה על מידע חסר).
-- שורד רענון והתארכות היסטוריה. מתנקה בשינוי כיוון/ביטול. JSON קטן על התיק.
alter table cases add column if not exists pending_request jsonb;
grant select, insert, update on cases to strauss_app;