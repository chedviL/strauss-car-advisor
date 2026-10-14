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

## Conversation tool contracts (over existing services)

| # | Decision | Rationale |
|---|---|---|
| D22 | Hypothetical change = scenario-level override (salary fields only). Shared facts + baseline unchanged. | O11 safe behavior: override never changes real eligibility; missing override inherits the current shared fact; removing override returns to inheritance (not zero). |
| D23 | updateCase (shared facts) separated from manageScenarios (alternatives + hypothetical). Explicit closed Zod schemas; no arbitrary JSON paths; no group/mandatory-car override via simulation. | point 2 of flexibility guidance; prevents eligibility bypass. |
| D24 | searchVehicles / compareScenarios compute eligibility + net in one batch over a consistent input snapshot, ranked by net delta, filtered by minNetDelta. No per-vehicle model call. Partial coverage never shown as best-of-all. | points 3+5. |
| D25 | Unknown eligibility (missing occupation) returns missing_data, not ineligible. No separate explainIneligible tool - search/compare carry reasons + excluded. | point 4. |
| D26 | openInquiry dedups by (case, type, context_fingerprint) among open inquiries; fingerprint built server-side. | point 4 (no duplicate rep inquiry). Pg: partial unique index uniq_open_inquiry (migration 0004). |
| D27 | Tool identity (owner/case/role/requestId) injected via ToolContext from the server, never from the model. | design S4.1 / S8. |

UI copy: fixed the נטo typo; comparison now reads 'נטו מחושב לפי כללי האתגר (לוחות 2025, שווי שימוש 2026)' and 'הנטו החודשי יגדל/יקטן ב-...'.

### Tests added (local, FILE repo)
scenario-flexibility.test.ts (10): override vs baseline, inheritance update, override removal, revision conflict, same-value no-bump, discover ranking + minNetDelta filter, partial coverage excluded, explicit multi + waiver, inquiry dedup + context change.
tool-contracts.test.ts (8): closed schemas reject arbitrary fields, override cannot change group (group-ד vehicle stays excluded for group-ב even at salary 90000), uniform envelope success/conflict, search eligibility, inquiry dedup via tool.

### Pending verification
- Postgres: scenario overrides column (0003), inquiries + uniq_open_inquiry (0004), updateFacts revision check under RLS - tests written, SKIPPED until DATABASE_URL.
- Conversation understanding (Hebrew, tool selection): requires a real model; mock tests do NOT prove it. The agent runtime (binding these tools to a model) is not yet built.

## Postgres connection prep (migrations hardening + setup guide)

| # | Decision | Rationale |
|---|---|---|
| D28 | strauss_app is a LOGIN role, RLS-subject, explicitly NOSUPERUSER/NOBYPASSRLS/NOCREATEDB/NOCREATEROLE (0002). Password set out-of-band (alter role), never in a migration. | app connects as a limited role; owner (postgres) runs migrations via MIGRATION_DATABASE_URL. |
| D29 | RLS policies made explicit WITH CHECK on every owner policy incl. inquiries (0005). | INSERT/UPDATE post-image gated at the DB, not relying on implicit USING->WITH CHECK copy. |
| D30 | Migrations applied as owner (MIGRATION_DATABASE_URL); app uses DATABASE_URL (strauss_app). Integration tests connect as the app role. | genuine least-privilege RLS verification. |

docs/supabase-setup.md: step-by-step (separate project, two connection strings, env
vars in .env.local only, run migrations as owner, set strauss_app password, run
integration tests as the app role, run app against Postgres).

Integration tests extended (now 12, all SKIPPED until DATABASE_URL): the decisive
raw-query-without-ownership-filter RLS test, BYPASSRLS/superuser guard, scenario
override persistence (0003), updateFacts revision conflict, inquiry dedup + unique
index (0004), inquiries isolation, concurrency.

NOT verified against Postgres yet: no local Postgres/Docker container could be
started in this session (tooling guard). Postgres remains PENDING until the user
runs the setup. File-store tests do NOT count as Postgres verification.

## Postgres connected + integration tests GREEN (live Supabase)

All 5 migrations applied to a separate Supabase project (owner conn). strauss_app
created as LOGIN, NOT superuser, NOT bypassrls. All 13 integration tests pass under
the strauss_app role, and the full suite is 81/81 with 0 skipped (DATABASE_URL set).

| # | Decision / fix | Rationale |
|---|---|---|
| D31 | Added SSL for non-local pg hosts (src/server/repositories/pg-ssl.ts; rejectUnauthorized=false). | Supabase requires TLS; connection was terminated without it. |
| D32 | 0002 made Supabase-compatible: no ALTER ROLE NOSUPERUSER/NOBYPASSRLS (managed postgres is not superuser and cannot set those). Role is non-super/non-bypass by default. | 'permission denied to alter role' on hosted Supabase. |
| D33 | set-app-password tool: password bound to set_config('strauss.app_pw',,true) then read via current_setting inside DO + format(%L). | Earlier / inside a DO block = outer statement has 0 params ('requires 0'). Keeps safe escaping, no raw concatenation, no shell arg; verified with a special-char throwaway role. |
| D34 (BUG caught by Postgres) | datasetId was rules.contentHash.slice(0,16) - not a UUID; cases.dataset_id is uuid FK. Added datasetId override to createDemoCaseFromEmployee; Postgres path uses the real seeded dataset UUID. File store masked this. | Production needs a real datasets row; seeding the active dataset into the datasets table is a PENDING task (not faked). |
| D35 | Global vitest testTimeout/hookTimeout = 30s. | Pooler round-trips exceed the default 5s for multi-step integration tests. |

PENDING (tracked, not faked): the production demo path still derives datasetId from
the rule-set hash; a dataset-row import into the datasets table is needed before the
Next.js app runs against Postgres end-to-end (the integration tests seed it manually).
Conversation/model runtime still not built (O8).

## Dataset import into Postgres + app uses real dataset UUID (end-to-end green)

Reproducible, content-hash-versioned dataset import seeds rule_sets + datasets +
vehicles into Postgres idempotently (re-run returns the same UUID; vehicles=20 not
duplicated). The active app path now resolves the REAL datasets.id UUID (read-only
lookup by content hash via the app role); the hash-slice shortcut is removed from
the active path (contentId kept only for the local file-store demo).

| # | Decision / fix | Rationale |
|---|---|---|
| D36 | DatasetRepository.ensureDataset (owner) upserts by combined content hash (rules+catalog+value-of-use source); findDatasetIdByContentHash (app, read-only) resolves the UUID. | reproducible, versioned, idempotent; app does not need owner creds at runtime. |
| D37 | import:dataset script seeds Postgres when MIGRATION_DATABASE_URL is set; prints the dataset UUID. | one reproducible import, no unique per-test manual seed for the app path. |
| D38 (BUG caught by Postgres) | RLS was effectively hiding config tables (datasets/vehicles/rule_sets) from the non-owner app role (owner bypasses RLS, so it saw rows; strauss_app saw 0). Migration 0007 disables RLS on these shared, non-owner config tables (0006 re-grants SELECT). | config tables are system data, not owner-scoped; the owner-scoped RLS belongs only to cases/facts/scenarios/messages/turn_runs/comparisons/inquiries. |
| D39 | createDemoCaseFromEmployee resolves dataset UUID via DATABASE_URL lookup; clear error if the dataset was not imported (run import:dataset). No silent file fallback when a DB is configured. | ties the compared result to the documented dataset version. |

Verified end-to-end against live Postgres (full suite 83/83, 0 skipped): employee
-> case (real dataset UUID) -> alternative -> compare (E-001 11032->11693) -> save
-> restore from a fresh service instance; cross-visit isolation; and re-running the
import does not duplicate or disrupt existing cases/comparisons (idempotent).
