# התראות מייל אחרי תשובת נציג — הגדרה והפעלה

כשנציג עונה לבירור, נוצרת משימת התראה עמידה במסד, ונשלח מייל לבעל/ת הבירור עם
קישור חזרה לבירור הנכון. ההתראה אינה מכילה שכר, נתוני תלוש או סכומים.

## איך זה עובד
1. בעת מענה הנציג נרשמת משימה בטבלת `notification_jobs` (idempotent לפי בירור+סוג).
   - `comparison_ready` — רק כשהתשובה הוחלה וההשוואה חושבה מחדש בפועל.
   - `answer_recorded` — כשהתשובה נרשמה אך טרם הוחלה (הקשר מיושן / תחולה עתידית /
     הערה בלבד). לעולם לא נכתב "ההשוואה מוכנה".
2. כשל במייל אינו מבטל את התשובה/החישוב שכבר נשמרו. המשימה נשארת ותנוסה שוב.
   *מיד אחרי שמירת התשובה* מתבצע ניסיון משלוח מיידי (best-effort, לא-חוסם) כדי
   שהמייל הראשון יצא סמוך לתשובה בלי להמתין למתזמן. אם הוא נכשל או שה-SMTP לא
   מוגדר, המשימה נשארת pending והמתזמן ישלח בניסיון הבא.
3. ה-worker (`/api/worker/notifications`) תופס משימות שהגיע זמנן, מברר את המייל
   המאומת של הנמען (Supabase Admin), שולח, ומסמן sent/failed. המייל עצמו אינו נשמר אצלנו.
4. הקישור עובר דרך `/go/case/<id>` — מחייב התחברות ומאמת בעלות לפני פתיחת הבירור.

## SMTP ברמת האפליקציה (Gmail) — למה צריך הגדרה נפרדת
ה-SMTP שהגדרת ב-Supabase שולח רק את מיילי ההתחברות של Supabase Auth, והוא אינו
נגיש לקוד שלנו. כדי שהאפליקציה תשלח התראות, היא מתחברת ישירות ל-SMTP עם *אותם*
פרטי Gmail (סיסמת אפליקציה). אין צורך ב-Resend או בדומיין.

הגדרות (`.env.local` מקומית, ו-Vercel → Environment Variables ל-Production):
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=<כתובת ה-Gmail>
SMTP_PASS=<סיסמת האפליקציה של Gmail (16 תווים, לא הסיסמה הרגילה)>
MAIL_FROM=שטראוס · יועץ הרכב <כתובת ה-Gmail>
CRON_SECRET=<מחרוזת אקראית ארוכה>
APP_BASE_URL=https://strauss-car-advisor.vercel.app
NOTIFY_DATABASE_URL=<חיבור strauss_notifier; נוצר ע"י npm run db:set-notifier-password>
```
הערות:
- `MAIL_FROM` חייב להשתמש בכתובת ה-Gmail עצמה (Gmail לא מאפשר התחזות לכתובת אחרת).
- `SMTP_PASS` = סיסמת אפליקציה (App Password), לא הסיסמה הרגילה. אותה סיסמה ששמת ב-Supabase תעבוד.

## הפעלת הניסיונות החוזרים בפריסה (מתזמן חיצוני חינמי)
בוטל ה-cron מ-`vercel.json` (ב-Hobby ה-cron מוגבל לרוב להרצה יומית, ואין כוונה
לשדרג לתשלום). הניסיון הראשון כבר יוצא *מיד* אחרי התשובה (משלוח מיידי), והניסיונות
החוזרים מופעלים ממתזמן חיצוני חינמי שקורא לנתיב ה-worker.

הנתיב: `POST https://strauss-car-advisor.vercel.app/api/worker/notifications`
עם הכותרת `Authorization: Bearer <CRON_SECRET>`. הנתיב פתוח למתזמן (ב-PUBLIC_PATHS
של ה-middleware, לא נחסם בשער ההתחברות של המשתמשים), אך מוגן ע"י `CRON_SECRET`:
בלי הכותרת הנכונה הוא מחזיר 401 ולא רץ.

### אפשרות א' — cron-job.org (הכי פשוט)
1. צור חשבון חינמי ב-cron-job.org.
2. Create cronjob → URL = הנתיב למעלה, Method = POST.
3. Headers → הוסף `Authorization` עם הערך `Bearer <CRON_SECRET>`.
4. Schedule = כל 2–5 דקות. שמור.

### אפשרות ב' — GitHub Actions (אם המאגר ב-GitHub)
צור `.github/workflows/notify-worker.yml`:
```yaml
name: notify-worker
on:
  schedule:
    - cron: "*/5 * * * *"   # כל 5 דקות (המינימום הנתמך ב-Actions)
  workflow_dispatch: {}
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: >
          curl -fsS -X POST
          -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
          https://strauss-car-advisor.vercel.app/api/worker/notifications
```
והוסף `CRON_SECRET` כ-Repository Secret (Settings → Secrets and variables → Actions),
עם *אותו* ערך שב-Vercel.

**חשוב:** הרצת GitHub Actions כל חמש דקות אינה הבטחת תזמון מדויקת.
גם cron ב-Actions וגם cron-job.org עשויים להתעכב, לדלג על הרצה בעומס, או לרוץ
בפער גדול מהמוגדר. זהו מנגנון *ניסיונות חוזרים* best-effort בלבד; המשלוח המהיר
מובטח ע"י המשלוח המיידי (after) סמוך לתשובה, לא ע"י המתזמן.

### ניסיונות חוזרים ומניעת כפילות
- כל תפיסה מגדילה `attempts` ודוחה את הניסיון הבא ב-backoff מוכפל (1,2,4,8… דקות).
  אחרי `max_attempts` (5) המשימה מסומנת `failed` וגלויה לתפעול.
- `FOR UPDATE SKIP LOCKED` מונע שני תהליכים מלתפוס את אותה משימה במקביל (למשל
  המשלוח המיידי והמתזמן), כך שלא נשלח פעמיים בו-זמנית.

### מגבלת כפילות ידועה (לא דה-דופ מוחלט)
`SKIP LOCKED` אינו הבטחה למניעת *כל* כפילות. סימון `sent` מתבצע רק *אחרי*
ש-Gmail קיבל את המייל. אם Gmail קיבל את המייל אך השרת קרס/נקטע *לפני* הסימון,
המשימה תישאר `pending`, והניסיון הבא ישלח שוב — כלומר ייתכן מייל כפול בודד
בתרחיש קריסה נדיר זה. זו החלטה מודעת: עדיף מייל כפול נדיר על פני אובדן התראה.
לא מומש דה-דופ חזק (כמו idempotency key אצל ספק המייל) כי אינו נדרש כרגע.

## הרשאות ה-worker במסד (תפקיד מצומצם)
ה-worker אינו רץ עוד בתפקיד הבעלים/מיגרציות (service role / bypassrls). נוסף תפקיד
ייעודי מצומצם `strauss_notifier` (מיגרציה 0016) שגישתו *אך ורק* לטבלת
`notification_jobs`:
- `SELECT` לקריאת משימות שהגיע זמנן ולבירור מזהה הנמען.
- `UPDATE` על העמודות `status, attempts, next_attempt_at, last_error, sent_at` בלבד —
  אינו יכול לשנות נמען/תיק/בירור/סוג, ולכן אינו יכול להסיט מייל ליעד אחר.
- אין לו גישה ל-`cases`, `messages`, `case_facts`, `scenarios`, `comparisons`,
  `inquiries` או לכל טבלת עובדים אחרת. התפקיד כפוף ל-RLS (אינו superuser/bypassrls).

כתובת המייל של הנמען *אינה* נקראת מהמסד אלא דרך Supabase Admin API לפי מזהה
המשתמש, ולכן ה-worker אינו זקוק לגישה ל-`auth.users`.

`CRON_SECRET` מגן על הנתיב ברמת ה-HTTP בלבד — הוא אינו מעניק הרשאות במסד.
ההרשאה נאכפת ברמת ה-DB דרך התפקיד המצומצם.

**הקמה (פעם אחת, מקומית):** לאחר `npm run db:migrate`, הגדר/י סיסמה לתפקיד ובנה/י
את מחרוזת החיבור:
```
npm run db:set-notifier-password
```
הכלי כותב `NOTIFY_DATABASE_URL` ל-`.env.local` (בלי להדפיס סודות) ומאמת שהתפקיד
רואה את `notification_jobs` אך *נחסם* מ-`cases`. ב-Vercel: הוסף/י `NOTIFY_DATABASE_URL`
כמשתנה Production (ראו הטבלה למטה). ה-worker משתמש *רק* ב-`NOTIFY_DATABASE_URL` —
אין fallback ל-`DATABASE_URL`/`MIGRATION_DATABASE_URL`; אם אינו מוגדר, ה-worker אינו רץ.

## בדיקה אמיתית (בתיאום)
משלוח המייל האמיתי טרם נבדק. נבצע אותו למייל שלך: נציג יענה לבירור, ונוודא שהמייל
מגיע, שאין בו פרטים כספיים, ושהקישור מחזיר לבירור הנכון אחרי התחברות.