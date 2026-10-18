# Strauss Car Advisor (יועץ הרכב של שטראוס)

סימולטור נטו בעברית לבחירת רכב. החישוב דטרמיניסטי בקוד; השיחה מתנהלת דרך מודל
(Claude) שבוחר כלים. חילוץ תלושים דרך מודל נפרד (Gemini). מסלול השיחה הפעיל: B.

## הרצה מקומית (npm scripts)
- `install`   — התקנת תלויות
- `dev`       — מסך העובד/ת ב-http://localhost:3000
- `test`      — חבילת Vitest (יחידה + אינטגרציה מול Postgres/Supabase כש-env מוגדר)
- `typecheck` — tsc --noEmit
- `build`     — בניית פרודקשן של Next.js
- `db:migrate`     — החלת מיגרציות SQL (דורש MIGRATION_DATABASE_URL)
- `import:dataset` — יבוא ה-dataset למסד (דורש חיבור)

הערה: אל תריצו `build` בזמן ש-`dev` פעיל, ואל תמחקו את `.next` תחת dev רץ
(עלול לגרום ל-Internal Server Error / webpack cache פגום). אם קרה — עצרו dev,
מחקו `.next`, הפעילו `dev` מחדש.

## מצב המוצר — מומש מול נבדק בפועל
מובחן בכוונה בין "מומש בקוד" לבין "נבדק בפועל" (end-to-end/בדפדפן).

### נבדק בפועל (אוטומטי): 197 בדיקות עוברות, 0 נכשלו, 0 דולגו
- **מנוע החישוב** (טהור): ששת עובדי הייחוס בהתאמה מדויקת לשקל; גילום חשמל +250 ₪
  נטו; שווי שימוש בבסיס המס בלבד; אי-שליליות ומונוטוניות (property-based).
- **יבוא נתונים**: CSV שווי שימוש (windows-1255) + קטלוג רכבים עם הכרעת provenance.
- **מצב/הרשאות מול Postgres אמיתי (RLS)**: יצירה/חלופה/חישוב/שחזור; בידוד בין
  בעלים; אילוץ baseline יחיד; קונפליקט גרסה; מקביליות שמירת הודעות.
- **זרימת תלוש (צד שרת, חילוץ מדומה ללא מודל)**: העלאה → שמירת חילוץ → שחזור
  חילוץ ממתין אחרי רענון → **אישור אטומי** (סימון applied + עדכון עובדות בטרנזקציה
  אחת; קונפליקט מגלגל את שניהם) → זיהוי חוסר (null≠0) → השלמה → השוואה → שחזור →
  אי-החלה כפולה → מדיניות אי-מחיקה אוטומטית בכשל.
- **אחסון תלושים ב-Supabase Storage (חי)**: העלאה, מחיקה, בידוד נתיב, בידוד
  בעלות דרך פעולות האפליקציה (RLS).
- **מסך הנציג מול Postgres**: מענה → החלה → חישוב מחדש בצד שרת → שחזור; בידוד
  בעלות; החלה-אם-רלוונטי (גרסה שהשתנתה); תחולה עתידית אינה מוחלת; אי-החלה כפולה.
- **סיווג כשל חילוץ**: הבחנה בין כשל מכסה (429) לכשל פענוח; חילוץ metric + retryDelay.

### מומש אך טרם נבדק מקצה-לקצה בפועל
- **חילוץ תלוש אמיתי עם Gemini** מקובץ (PDF/סריקה). הפייפליין אומת מול PDF עם
  שכבת טקסט; בדיקת הסריקות (ברורה/מעומעמת) ממתינה לאיפוס מכסת ה-free-tier.
- **בדיקה ידנית בדפדפן** של זרימת התלוש המלאה (ראו docs/payslip-browser-test.md).
- **הורדת הקובץ הבינארי מ-Supabase** — נחסמה בסביבת הפיתוח ע"י מסנן רשת (NetFree);
  העלאה/מחיקה אומתו, הורדה טרם. אמורה לעבוד בפריסה. ראו docs/supabase-setup.md.

## חיבור Supabase / Postgres
הגדירו ב-.env.local (לא בצ'אט, לא ב-git). העתיקו את .env.example ומלאו:
- `DATABASE_URL`              — תפקיד האפליקציה (strauss_app) הכפוף ל-RLS. נדרש לריצה.
- `MIGRATION_DATABASE_URL`    — תפקיד הבעלים, להרצת מיגרציות בלבד (לא לפריסה).
- `SUPABASE_URL`              — Project URL (https://<ref>.supabase.co).
- `SUPABASE_SERVICE_ROLE_KEY` — service_role (סוד; צד שרת בלבד) לאחסון התלושים.
- `MODEL_API_KEY`             — Claude (שיחה).
- `MODEL_API_KEY3`            — Gemini (חילוץ; גיבוי: MODEL_API_KEY2).
- `CHAT_FAST_PATH=0`          — מסלול B הפעיל.

פרטי התקנה מלאים: docs/supabase-setup.md. פריסת Vercel: docs/vercel-deploy.md.

### אכיפת RLS
PgCaseRepository פותח טרנזקציה לכל פעולה ומגדיר `app.owner_id` דרך
`set_config(..., true)` (scope טרנזקציה). פוליסות RLS מסננות כל שאילתה לפי
`current_setting('app.owner_id')`. ה-owner_id מוזרק מהשרת בלבד (cookie ביקור
בדמו, או auth.uid() באימות אמיתי) — לעולם לא מהלקוח.

## ארכיטקטורה
- `src/domain/calculation` — מנוע חישוב טהור (decimal.js), ללא רשת/מסד/מודל.
- `src/domain/eligibility` — זכאות דטרמיניסטית.
- `src/server/repositories` — יבוא CSV/קטלוג; CaseRepository (File + Pg).
- `src/server/services`     — שירותי אפליקציה משותפים (UI/סוכן/worker).
- `src/server/agent`        — ריצת שיחה, כלים, חילוץ תלוש (Gemini).
- `src/server/web`          — אחסון תלושים, בחירת backend, טעינת env.
- `src/app`, `src/features` — Next.js App Router, מסך עברי/RTL, מסך נציג, design tokens.
- `supabase/migrations`     — סכמת המסד עם RLS ואילוצים.

## מגבלות ידועות
- חילוץ תלוש תלוי במכסת Gemini החינמית; במיצוי מוחזרת הודעת 429 מתאימה, ללא
  מעבר אוטומטי לספק בתשלום.
- אחסון מקומי (STRAUSS_ALLOW_FILE_STORE=1) מיועד לפיתוח/בדיקות בלבד; בפרודקשן
  הוא נכשל בבירור (חובה Supabase Storage).
- מצב ההחלטות הפתוחות: docs/decision-log.md.
- מסמכי האפיון (requirements/design/tasks) תחת .kiro/specs/strauss-car-advisor/.