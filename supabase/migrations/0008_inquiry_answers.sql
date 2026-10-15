-- supabase/migrations/0008_inquiry_answers.sql
-- עמודות לתשובת נציג על פנייה: ערך מובנה, סוג, תחולה, וחותמת מענה.
-- מאפשר שהמודל יקבל "תשובות שהתקבלו" בתור הבא (הקשר נכון בכל תור).
alter table inquiries add column if not exists answer_value numeric;        -- ערך מספרי (למשל השתתפות ₪)
alter table inquiries add column if not exists answer_note text;            -- הערה חופשית קצרה מהנציג
alter table inquiries add column if not exists effective_from date;         -- תחולה (למשל 1/1)
alter table inquiries add column if not exists answered_at timestamptz;     -- מתי נענתה

-- כשפנייה נענית, הסטטוס עובר ל-answered והאינדקס הייחודי (status='open') משתחרר.
grant select, insert, update on inquiries to strauss_app;