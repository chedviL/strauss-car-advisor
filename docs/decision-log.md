# יומן החלטות — יועץ הרכב של שטראוס

מסמך זה מתעד החלטות מימוש שגרתיות (שהתקבלו עצמאית) ואת מצב ההחלטות העסקיות
הפתוחות (O1–O14). ההחלטות העסקיות המלאות מתועדות ב-`.kiro/specs/strauss-car-advisor/`.

## החלטות מימוש שגרתיות (שלב 0–2)

| # | החלטה | נימוק |
|---|---|---|
| D1 | נעילת גרסאות: TypeScript 5.9.3, Vitest 2.1.9, Zod 3.25.76, fast-check 3.23.2, decimal.js 10.6.0, tsx 4.23.15 | majors יציבים ובדוקים. ה-registry הציע TS7/Vitest5 (חדשים מדי) — נבחר baseline שמרני לפי הוראת שער הנעילה בעיצוב §2. ייבדק מול Next.js בשלב ה-UI |
| D2 | מודול ESM (`"type":"module"`), tsconfig strict מלא כולל noUncheckedIndexedAccess ו-exactOptionalPropertyTypes | בטיחות טיפוסים מרבית לליבה הכספית |
| D3 | כסף כ-`decimal.js` עם precision=40, עיגול ROUND_HALF_UP | מניעת floating point; מדיניות עיגול לפי rounding ב-rule-set |
| D4 | כל קודי המפתח נשמרים כמחרוזות עם אפסים מובילים | AC-2.1.9; הסרת אפסים הייתה שוברת את מפתח המס |
| D5 | שנת מס לשליפת שווי שימוש = "2026" (קבוע בשכבת היבוא) | מקור שווי השימוש הוא 2026; נפרד משנת לוחות החישוב 2025 (AC-2.8) |
| D6 | פתרון גילום החשמל ב-bisection חסום (200 איטרציות, סובלנות 1e-8) | ללא נוסחת 250/(1-rate); מכבד מעברי מדרגה/תקרה (AC-2.3.2) |
| D7 | עמודת "ביטוח לאומי+בריאות" מעוגלת כסכום משולב פעם אחת (לא round של כל רכיב) | תואם להגדרת עמודת הייחוס; עיגול בתצוגה בלבד (O7) |
| D8 | ברירות מחדל בטעינת כללים לקובץ הישן: contributionsBase=gross, maxContributionRate=0.07, rounding={none,shekel} | תאימות לאחור; נרשמות ב-appliedDefaults בדוח היבוא לשקיפות |
| D9 | windows-1255 מפוענח עם TextDecoder מובנה של Node | ללא תלות חיצונית; אומת מול הקובץ בפועל |

## מצב ההחלטות העסקיות הפתוחות

| מזהה | מצב | הערה |
|---|---|---|
| O2 | **הוכרע** | contributionsBase=gross בקובץ המעודכן |
| O3 | **הוכרע** | pensionCredit: 35% עד 7%×9,500 |
| O6 | **הוכרע (עדות)** | השתתפות + פער משפחתי מנוכים בנפרד |
| O7 | **הוכרע** | אין עיגול בחישוב, שקל בתצוגה |
| O14 | **הוכרע (שיטה)** | קוד סוג רכב לפי תאור דגם + כינוי מסחרי, לא לפי סכום |
| O1 | פתוח | מקור השתתפות (ברירת מחדל מול ערך אישי). התנהגות בטוחה: לא להציג default כמאומת |
| O4 | פתוח | פירוש "עד גיל 23" במקרי גבול. התנהגות בטוחה: לא לאשר גבולי אוטומטית |
| O5 | פתוח | תחולה אמצע חודש. התנהגות בטוחה: ללא prorating לא מוגדר |
| O8 | פתוח | מודל שיחה/חילוץ. ייבחר ב-eval; env משתנים מוכנים |
| O9 | פתוח | scanner/retention למסמכים. ללא נתוני שכר אמיתיים עד הגדרה |
| O10 | פתוח | פריסה/worker/cron |
| O11 | פתוח | סימולציה היפותטית. התנהגות בטוחה: לא לדרוס פרופיל |
| O12 | פתוח | רכב מחוץ לקטלוג. התנהגות בטוחה: לא להסיק תנאי חברה |
| O13 | פתוח | אמצעי אימות נציג. deny-by-default |

## אימות שבוצע

- מנוע החישוב: כל 12 ערכי ששת העובדים (net/tax/ni+health) תואמים לייחוס בדיוק לשקל.
- גילום חשמל: +250 ₪ נטו בדיוק ב-8 רמות שכר (כולל חציית תקרות), ללא ספירה כפולה.
- יבוא CSV: 77,988 רשומות, 0 כפילויות מפתח; כל 20 הרכבים נפתרו ואומתו במפתח 5 חלקים.
- עמימות ATTO 3/TANG נפתרה לפי תאור דגם, לא לפי סכום.
## החלטות מימוש שגרתיות (שלב 3 — מצב/הרשאות + חתך עובד)

| # | החלטה | נימוק |
|---|---|---|
| D10 | נעילת UI: Next.js 15.5.27, React 19.3.0, @supabase/supabase-js 2.117.3, @supabase/ssr 0.12.7 | אומת מול התיעוד הרשמי (ראו "אימות תאימות גרסאות" למטה) |
| D11 | שכבת persistence מאחורי ממשק `CaseRepository`; מימוש `FileCaseRepository` (קובץ JSON לכל תיק תחת data/state/<owner>) לחתך הדגמה והבדיקות | אין credentials ל-Supabase (env ריק); המימוש מאחורי ממשק כך ש-Supabase-Postgres יחליף אותו בלבד. ה-SQL migration (0001) הוא מקור הסכמה עם RLS ואילוצים אמיתיים |
| D12 | בידוד ביקור הדגמה: owner_id = מזהה ביקור מ-cookie httpOnly (SameSite=Lax), מוזרק מהשרת בלבד | מקביל ל-auth.uid() ב-RLS; הלקוח לעולם אינו קובע owner_id (AC-3.2.1) |
| D13 | ייבוא עם סיומת .js גם בקוד ה-UI; Next webpack extensionAlias פותר .js→.ts/.tsx | ייבוא עקבי בין vitest (NodeNext) ל-Next, בלי כפל קונבנציות |
| D14 | design tokens כ-CSS variables ב-globals.css; אין סגנונות קשיחים בלוגיקה | re-skin ללא שינוי לוגיקה (REQ-8.1); רווח/הפסד מסומן בחץ+מילה, לא בצבע בלבד |
| D15 | כפתור "אזור נציג" ב-flex-start (RTL = צד שמאל) | החלטת UX סגורה (פינה שמאלית עליונה) |
| D16 | מופע שירות יחיד לצד שרת; Server Actions מתזמרות בלבד, אין חישוב בהן | גבולות מודולים (design §1.2); המנוע נשאר טהור |

## אימות תאימות גרסאות (מול תיעוד רשמי)

נבדק מול התיעוד הרשמי — גיל הגרסה אינו שיקול יחיד:
- **Next.js 15 + React 19**: נתמך רשמית לפי תיעוד Next.js (upgrade guide). Next.js דורש Node.js ≥ 18.17; הסביבה על Node 24.
- **Supabase ל-Next.js**: החבילה הרשמית ל-session מבוסס-cookie היא `@supabase/ssr` (בנויה מעל `@supabase/supabase-js`), עם createBrowserClient/createServerClient. תיעוד Supabase מציין ש-`@supabase/ssr` ב-beta וה-API עשוי להשתנות — לכן השימוש בה יבודד מאחורי שכבת ה-repository, וחתך הדגמה אינו תלוי בה.
- **לא נבחרו גרסאות בלידינג-אדג'** (TypeScript 7 / Vitest 5 / Next 16) למרות שקיימות ב-registry: baseline שמרני מפחית סיכון תאימות בזמן ההאקתון. ייבחן מחדש אם יידרש.

(תוכן נוסח מחדש לצורך עמידה בהגבלות רישוי התוכן.)

## Supabase / Postgres (repository + RLS)

| # | Decision | Rationale |
|---|---|---|
| D17 | CaseRepository interface made ASYNC; FileCaseRepository + PgCaseRepository both implement it | a real DB is async; service/actions/page/test updated to await |
| D18 | PgCaseRepository uses node-postgres (pg 8.23.1); each op in a txn with set_config('app.owner_id', ..., true) | genuinely exercises the migration RLS policies, not a bypass |
| D19 | Service picks repo by env: DATABASE_URL set -> Pg (Postgres+RLS), else File (local demo) | lets the demo run with zero cloud deps; Postgres swaps in by setting one env var |
| D20 | Postgres integration tests use describe.skip when DATABASE_URL is absent | file-storage tests are NEVER counted as Postgres verification; pending until connected |
| D21 | Migration runner (scripts/db/migrate.ts) tracks applied files in _migrations | reproducible, idempotent migration apply |

### Test accounting (actual run, JSON reporter)
57 total = 51 passed + 6 skipped (0 failed). Per file: six-employees 13, electric-gross-up 11, catalog-conformance 9, properties(PBT) 6, eligibility 6, case-flow 5, pg-rls 1 passed + 6 skipped. The earlier table said properties=10 in error; actual is 6.

### Still unverified
- Postgres RLS/isolation/concurrency: pending DATABASE_URL (tests written, skipped).
- Conversation (agent + model): not wired; O8 model choice open; marked unverified.
