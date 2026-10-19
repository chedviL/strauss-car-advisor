-- supabase/migrations/0017_one_alternative_per_case.sql
-- תיקון מרוץ: שתי קריאות upsertAlternative מקבילות לאותו תיק יצרו שתי שורות
-- alternative (read-then-insert בלי סריאליזציה). שתי שכבות הגנה:
--   1. סריאליזציה בקוד: SELECT ... FOR UPDATE על שורת התיק (כמו ב-appendMessages).
--   2. אילוץ מסד כאן: אינדקס ייחודי חלקי - לכל תיק לכל היותר alternative אחת.
-- האינדקס הוא הגנת-אמת: גם אם נתיב קוד עתידי יעקוף את הנעילה, המסד ימנע כפילות.
--
-- אם קיימות כבר כפילויות היסטוריות (מהמרוץ), משאירים את העדכנית ביותר (או עם
-- ה-revision הגבוה) ומוחקים את השאר, אחרת יצירת האינדקס תיכשל.

-- ניקוי כפילויות קיימות: לכל (case_id) שומרים alternative אחת (revision גבוה,
-- ואז ctid כשובר-שוויון) ומוחקים את השאר.
delete from scenarios s
 using (
   select case_id,
          (array_agg(id order by revision desc, ctid desc))[1] as keep_id
     from scenarios
    where role = 'alternative'
    group by case_id
   having count(*) > 1
 ) dup
 where s.case_id = dup.case_id
   and s.role = 'alternative'
   and s.id <> dup.keep_id;

create unique index if not exists uniq_one_alternative_per_case
  on scenarios(case_id) where role = 'alternative';
