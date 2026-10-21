# התחברות והרשאות — הגדרה והנחיות

כניסה בקוד חד-פעמי למייל (Supabase Auth). ללא סיסמה, ללא הרשמה נפרדת, ללא כניסת הדגמה.
הבעלות על תיקים ומסמכים נקבעת בשרת לפי המשתמש המאומת (`owner_id` = מזהה משתמש Supabase).

> **מצב אימות:** הקוד, ההרשאות והבידוד נבדקו אוטומטית (קוד חד-פעמי אמיתי מול Supabase Auth,
> Postgres עם RLS). **שליחת מייל אמיתית עדיין לא נבדקה** — היא דורשת SMTP מוגדר ובדיקה ידנית
> שלך (סעיף 6). אל תסמני אותה כמאומתת עד שקוד אמיתי הגיע לתיבה והכניסה הצליחה.

## 1. מה צריך להגדיר (סודות ומשתנים)

| משתנה | איפה | הערה |
|---|---|---|
| `SUPABASE_URL` | Vercel + `.env.local` | כבר מוגדר. `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | Vercel + `.env.local` | **חסר כרגע.** המפתח הציבורי (`anon` / publishable). בלעדיו כל האתר חסום בכוונה. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel + `.env.local` | כבר מוגדר (אחסון תלושים). לא משמש להתחברות. |
| `DATABASE_URL` | Vercel + `.env.local` | כבר מוגדר. |

איפה למצוא את `SUPABASE_ANON_KEY`: Supabase → Project Settings → API (או "API Keys") → `anon` / `publishable`.
**לא** `service_role`. הערך אינו סוד קריטי, אבל שומרים אותו כמו שאר המשתנים ולא בצ'אט.

אין משתנים עם `NEXT_PUBLIC`. כל פעולות ההתחברות רצות בשרת, והעוגיות הן `httpOnly`.

## 2. הגדרת ה-Auth ב-Supabase (Dashboard → Authentication)

1. **Providers → Email**: מופעל. כבי "Confirm email" אם הוא מבקש אישור נפרד; הכניסה בקוד מספיקה.
   השאירי "Allow new users to sign up" **מופעל** — הקוד הראשון יוצר את החשבון (אין הרשמה נפרדת).
2. **Email OTP**: אורך הקוד (6 כברירת מחדל) ותוקף (Email OTP Expiration). הממשק מקבל 6–10 ספרות.
3. **URL Configuration**: Site URL = כתובת Vercel (`https://strauss-car-advisor.vercel.app`);
   Redirect URLs = אותה כתובת + `http://localhost:3000`.
4. **תבניות המייל (חשוב מאוד)** — Authentication → Emails → Templates. תבנית ברירת המחדל שולחת
   *קישור*, לא קוד. ערכי את שתי התבניות כך שיכילו את הקוד:
   - **Magic Link** (משתמש קיים) ו-**Confirm signup** (משתמש חדש): הוסיפי `{{ .Token }}`, למשל:
     ```html
     <h2>קוד הכניסה שלך</h2>
     <p>הקוד: <strong style="font-size:22px;letter-spacing:4px">{{ .Token }}</strong></p>
     <p>הוא תקף לזמן קצר. אם לא ביקשת להיכנס — אפשר להתעלם.</p>
     ```
   בלי `{{ .Token }}` המשתמשת תקבל מייל בלי קוד ולא תוכל להיכנס.

## 3. משלוח מיילים אמיתי (SMTP מותאם) — Resend

שירות המייל המובנה של Supabase מוגבל מאוד (מספר קטן של מיילים בשעה, ורק לחברי הצוות) ולא מיועד לשימוש אמיתי.

1. ב-Resend: **Domains → Add Domain**, והוסיפי ל-DNS של הדומיין את רשומות SPF ו-DKIM שהם נותנים. המתיני ל-Verified.
2. ב-Resend: **API Keys → Create** (הרשאת Sending). זה הסיסמה ל-SMTP. שמרי רק ב-Supabase (ולא בקוד/בצ'אט).
3. ב-Supabase: Authentication → **SMTP Settings** → Enable Custom SMTP:
   - Host: `smtp.resend.com` · Port: `465` · Username: `resend` · Password: מפתח ה-API.
   - Sender email: כתובת בדומיין המאומת (למשל `no-reply@yourdomain.com`) · Sender name: `שטראוס · יועץ הרכב`.
4. Authentication → **Rate Limits**: הגדילי "Emails sent per hour" (ברירת המחדל נמוכה). מרווח של 60 שניות בין קודים לאותה כתובת קיים ב-Supabase, ובנוסף באפליקציה.

## 4. מתן תפקיד נציג (ערוץ ניהולי בלבד)

אין מסך למתן הרשאות ואין דרך לקבל אותן מהאפליקציה: טבלת `staff_roles` נכתבת רק מכאן. הנציגה צריכה קודם להיכנס פעם אחת (כדי שהחשבון ייווצר).
ב-Supabase → SQL Editor (בתפקיד הבעלים):

```sql
-- הענקה: נציגה לפניות על השתתפות ברכב בלבד
insert into staff_roles (user_id, role, active, scope)
select id::text, 'representative', true, '{"inquiryTypes":["employee_participation"]}'::jsonb
  from auth.users where email = 'rep@yourdomain.com';

-- הוספת סוג פנייה: employee_participation, occupation_eligibility_clarification
-- ביטול מיידי:
update staff_roles set active = false
 where user_id = (select id::text from auth.users where email = 'rep@yourdomain.com');
```
הנציגה רואה רק פניות מהסוגים שהוענקו, ללא שכר, נטו או מייל של העובד/ת. עובד רגיל שקורא ישירות לפעולת המענה — נדחה.

## 5. פריסה ב-Vercel

הוסיפי `SUPABASE_ANON_KEY` ל-Environment Variables (Production, ואם רלוונטי Preview) ובצעי Redeploy.
**אל תמזגי ל-`main` לפני שהמפתח, התבניות וה-SMTP מוגדרים** — כניסה היא חובה, ואתר חי בלי הגדרות אלה יציג למשתמשים הודעה שההתחברות לא הוגדרה.

## 6. בדיקת קבלה ידנית (כשהכול מוגדר)

1. פתחי חלון גלישה פרטי → האתר מפנה ל-`/login`.
2. הזיני מייל אמיתי → "שליחת קוד". **המייל מגיע?** הקוד בגוף ההודעה (לא קישור)? (זו הבדיקה שעדיין לא בוצעה.)
3. הדביקי את הקוד → נכנסת ל"הבירורים שלי". רענון הדף → עדיין מחוברת.
4. שיחה חדשה → שלחי הודעה → חזרי ל"הבירורים שלי": הבירור מופיע. "המשך" פותח אותו עם ההיסטוריה.
5. "יציאה" → מופנית ל-`/login`; הכפתור "אחורה" בדפדפן לא מציג את השיחה הקודמת.
6. כניסה מדפדפן/מכשיר אחר עם אותו מייל → אותם בירורים.
7. כניסה עם מייל שני → רשימה ריקה (בירורים של החשבון הראשון אינם נראים).
8. נציגה (אחרי סעיף 4): "אזור נציג" מופיע ורואה פניות. חשבון רגיל: אין קישור, ו-`/representative` מציג "אין לך הרשאת נציג".

## 7. התנהגויות שחשוב לדעת

- תיקים שנוצרו לפני הכניסה (כניסת ההדגמה הקודמת) **אינם** משויכים לשום מייל, ואינם נראים אחרי ההתחברות. הם נשארים במסד, לא נמחקו.
- הודעות שגיאה בכניסה אחידות ואינן חושפות אם כתובת קיימת.
- סשן מתחדש אוטומטית; יציאה מבטלת גם את ה-refresh token בשרת.