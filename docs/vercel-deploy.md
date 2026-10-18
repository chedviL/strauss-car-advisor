# פריסת הדגמה ב-Vercel — מדריך

פריסה מהמאגר הקיים (Next.js 15, App Router). הכול רץ בצד שרת; אין סודות בצד הלקוח.
אין תלות בדיסק מקומי: תיקים/תלושים נשמרים ב-Postgres (Supabase) וב-Supabase Storage.

## דרישות מוקדמות (כבר בוצעו)
- פרויקט Supabase עם המיגרציות וה-dataset מיובאים (npm run import:dataset).
- bucket פרטי "payslips" ב-Supabase Storage.
- תפקיד strauss_app (RLS) עם סיסמה — זהו ה-DATABASE_URL לריצה.

## משתני סביבה לפריסה (Vercel → Project → Settings → Environment Variables)
הגדירו כ-**Production** (ו-Preview אם תרצו). אל תסמנו שום משתנה כ-"expose to browser".
אין קידומת NEXT_PUBLIC לאף אחד מאלה — כולם צד-שרת.

חובה (ריצה):
- `DATABASE_URL`              — חיבור תפקיד האפליקציה strauss_app (RLS). מומלץ Supavisor transaction mode (6543).
- `SUPABASE_URL`             — https://<project-ref>.supabase.co (בלי נתיב, בלי / בסוף).
- `SUPABASE_SERVICE_ROLE_KEY`— מפתח service_role (סוד; צד שרת בלבד).
- `SUPABASE_ANON_KEY`         — מפתח ציבורי (anon/publishable) להתחברות בקוד חד-פעמי. **חובה**: בלעדיו האתר חסום. ראו docs/auth-setup.md.
- `MODEL_API_KEY`            — מפתח Claude (שיחה).
- `MODEL_API_KEY3`           — מפתח Gemini הפעיל לחילוץ תלושים (החליף את KEY2).
- `MODEL_API_KEY2`           — מפתח Gemini גיבוי לחילוץ (אם KEY3 לא הוגדר). אופציונלי אם KEY3 קיים.

אופציונלי (ברירות מחדל בקוד; הגדירו רק לשינוי):
- `CHAT_FAST_PATH`           — מסלול השיחה. השאירו `0` (מסלול B) כפי שסוכם.
- `MODEL_ID`                 — ברירת מחדל claude-sonnet-5-5.
- `MODEL_EFFORT`             — ברירת מחדל medium.
- `EXTRACTION_MODEL_ID`      — ברירת מחדל gemini-3.8-flash.

לא להעביר לפריסה:
- `MIGRATION_DATABASE_URL`   — חיבור הבעלים להרצת מיגרציות בלבד. **אינו נחוץ לריצה** ואינו
  מופיע בקוד השרת. אל תוסיפו אותו ל-Vercel.
- `STRAUSS_ALLOW_FILE_STORE` — אחסון מקומי, פיתוח/בדיקות בלבד. בפרודקשן הוא **נכשל בכוונה**
  (StorageConfigError/ConfigError). אל תגדירו אותו.
- `RESEND_API_KEY`, `MAIL_*`, `APP_BASE_URL` — טרם בשימוש בקוד; לא נדרשים כעת.

## שלבי חיבור והוספת הסודות (בממשק Vercel)
1. היכנסו ל-https://vercel.com, התחברו, ו-**Add New → Project**.
2. **Import Git Repository** → בחרו את `chedviL/strauss-car-advisor`, branch `main`.
   (אם המאגר פרטי, אשרו הרשאת GitHub ל-Vercel.)
3. Framework Preset יזוהה אוטומטית כ-**Next.js**. Build/Install נקבעים גם ב-vercel.json.
4. לפני Deploy ראשון, פתחו **Environment Variables** והוסיפו את משתני ה"חובה" למעלה.
   הדביקו ערכים בשדה הערך בלבד; Vercel מצפין אותם. אל תשלחו ערכים בצ'אט.
5. לחצו **Deploy**. בסיום תקבלו כתובת (…vercel.app).
6. בדיקת עשן מהירה: פתחו את הכתובת; ודאו שמסך הפתיחה נטען ושהשיחה עונה.

## אימות אחרי פריסה (בקישור האמיתי)
בצעו בדפדפן על ה-URL של Vercel (ראו docs/payslip-browser-test.md):
תלוש סינתטי → העלאה → חילוץ (Gemini, מכסה חינמית) → אישור → השוואה → רענון.
רק אחרי שזה עובד מקצה-לקצה בקישור האמיתי — נסמן את זרימת התלוש כמאומתת.
(הורדת הקובץ מ-Supabase שנחסמה מקומית ב-NetFree אמורה לעבוד בשרת Vercel.)

## הערות
- מפתח ה-service role ו-DATABASE_URL הם סודות. הם נשמרים רק ב-Vercel וב-.env.local
  המקומי (git-ignored); לעולם לא במאגר ולא בצ'אט.
- אין מעבר שקט לדיסק מקומי: ללא SUPABASE_URL+SERVICE_ROLE_KEY בסביבה עם DATABASE_URL,
  העלאת תלוש נכשלת בהודעה ברורה (לפי התכנון).