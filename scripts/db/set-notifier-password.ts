// scripts/db/set-notifier-password.ts
// כלי הקמה מקומי: מבקש סיסמה חדשה ל-strauss_notifier בהקלדה מוסתרת + אישור חוזר,
// מגדיר אותה דרך חיבור הבעלים הקיים (MIGRATION_DATABASE_URL) ב-ALTER ROLE
// פרמטרי (בלי להרכיב SQL עם הסיסמה ובלי להעביר אותה כארגומנט shell),
// ומרכיב NOTIFY_DATABASE_URL עם percent-encoding אוטומטי. שאר .env.local נשמר.
//
// הפעלה: node --import tsx scripts/db/set-notifier-password.ts
// הכלי אינו מדפיס סיסמאות, SQL עם סיסמה, או מחרוזות חיבור.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { Client } from "pg";
import { loadEnv } from "../../src/server/web/load-env.js";
import { sslFor } from "../../src/server/repositories/pg-ssl.js";

const APP_ROLE = "strauss_notifier";
const ENV_PATH = join(process.cwd(), ".env.local");

/** קריאת שורה עם מסך מוסתר (ללא הד של התווים). */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    let muted = false;
    const mutedOut = new Writable({
      write(chunk, _enc, cb) {
        if (!muted) process.stdout.write(chunk);
        cb();
      },
    });
    const rl = createInterface({ input: process.stdin, output: mutedOut, terminal: true });
    process.stdout.write(question);
    muted = true;
    rl.question("", (answer) => {
      muted = false;
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

/** בונה NOTIFY_DATABASE_URL מתוך MIGRATION_DATABASE_URL: מחליף משתמש ל-strauss_notifier וסיסמה. */
function buildAppUrl(ownerUrl: string, appPassword: string): string {
  const u = new URL(ownerUrl);
  // שם המשתמש של הבעלים: postgres[.PROJECT-REF] -> strauss_notifier[.PROJECT-REF]
  const ownerUser = decodeURIComponent(u.username);
  const dotIdx = ownerUser.indexOf(".");
  const ref = dotIdx >= 0 ? ownerUser.slice(dotIdx) : ""; // כולל הנקודה
  const appUser = APP_ROLE + ref;
  u.username = encodeURIComponent(appUser);
  // percent-encoding אוטומטי של הסיסמה בתוך ה-userinfo:
  u.password = encodeURIComponent(appPassword);
  // פורט אפליקציה: אם הבעלים ב-5432 (session) נשאיר; אפשר 6543 ל-transaction.
  return u.toString();
}

/** עדכון שורת NOTIFY_DATABASE_URL בלבד ב-.env.local; שאר השורות נשמרות. מאמת כתיבה. */
function updateEnvLocal(newUrl: string): void {
  const text = readFileSync(ENV_PATH, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  let found = false;
  const out = lines.map((line) => {
    if (/^NOTIFY_DATABASE_URL=/.test(line)) {
      found = true;
      return `NOTIFY_DATABASE_URL=${newUrl}`;
    }
    return line;
  });
  if (!found) out.push(`NOTIFY_DATABASE_URL=${newUrl}`);
  writeFileSync(ENV_PATH, out.join(eol), "utf8");

  // אימות כתיבה: קוראים חזרה ומוודאים שהשורה אינה ריקה (בלי להדפיס את הערך).
  const check = readFileSync(ENV_PATH, "utf8").split(/\r?\n/)
    .find((l) => /^NOTIFY_DATABASE_URL=/.test(l)) ?? "";
  const writtenLen = check.replace(/^NOTIFY_DATABASE_URL=/, "").length;
  if (writtenLen === 0) {
    throw new Error("כתיבת NOTIFY_DATABASE_URL ל-.env.local נכשלה (השורה ריקה לאחר הכתיבה).");
  }
  console.log(`NOTIFY_DATABASE_URL נכתב ל-.env.local (אורך ערך: ${writtenLen} תווים).`);
}

async function main(): Promise<void> {
  loadEnv();
  const ownerUrl = process.env.MIGRATION_DATABASE_URL;
  if (!ownerUrl) {
    console.error("MIGRATION_DATABASE_URL לא מוגדר ב-.env.local. ראו docs/supabase-setup.md.");
    process.exit(1);
  }

  const pw1 = await promptHidden("בחר/י סיסמה חדשה ל-strauss_notifier (מוסתר): ");
  if (pw1.length < 12) {
    console.error("הסיסמה קצרה מדי (מינימום 12 תווים). לא בוצע שינוי.");
    process.exit(1);
  }
  const pw2 = await promptHidden("אישור הסיסמה (הקלד/י שוב): ");
  if (pw1 !== pw2) {
    console.error("הסיסמאות אינן תואמות. לא בוצע שינוי.");
    process.exit(1);
  }

  // הגדרת הסיסמה דרך פונקציית מסד פרמטרית - בלי להרכיב SQL עם הסיסמה.
  // ALTER ROLE אינו תומך בפרמטר ישיר, לכן משתמשים ב-format(%L) בתוך פונקציה
  // שמקבלת את הסיסמה כפרמטר bound (לא כקונקטנציה). השרת עושה quoting בטוח.
  const client = new Client({ connectionString: ownerUrl, ...sslFor(ownerUrl) });
  await client.connect();
  try {
    await client.query("begin");
    // הסיסמה עוברת כפרמטר bound ל-set_config (שאילתה חיצונית אמיתית עם פרמטר),
    // ונשמרת ב-GUC מקומי-לטרנזקציה. אין שרשור של הסיסמה ל-SQL ואין ארגומנט shell.
    await client.query("select set_config('strauss.notifier_pw', $1, true)", [pw1]);
    // בתוך ה-DO קוראים את ה-GUC ומבצעים escaping בטוח עם format(%L).
    // %I על שם התפקיד, %L על הסיסמה (ציטוט ליטרלי בטוח של השרת).
    await client.query(
      `do $do$
       begin
         execute format(
           'alter role %I with password %L',
           'strauss_notifier',
           current_setting('strauss.notifier_pw', true)
         );
       end
       $do$;`,
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }

  const appUrl = buildAppUrl(ownerUrl, pw1);
  updateEnvLocal(appUrl);

  // אימות חיבור בפועל כ-strauss_notifier (לא מדפיס את מחרוזת החיבור/סיסמה).
  const appClient = new Client({ connectionString: appUrl, ...sslFor(appUrl) });
  try {
    await appClient.connect();
    const who = await appClient.query("select current_user as u");
    if (who.rows[0]?.u !== "strauss_notifier") {
      throw new Error(`התחברות לא כ-strauss_notifier (current_user לא צפוי).`);
    }
    // אימות היקף מצומצם: יש גישה ל-notification_jobs, ואין גישה כללית ל-cases.
    await appClient.query("select count(*)::int n from notification_jobs"); // חייב להצליח
    let deniedCases = false;
    try {
      await appClient.query("select count(*) from cases");
    } catch {
      deniedCases = true; // אין GRANT על cases -> permission denied (רצוי)
    }
    if (!deniedCases) {
      throw new Error("היקף רחב מדי: strauss_notifier הצליח לקרוא מ-cases.");
    }
  } finally {
    await appClient.end().catch(() => {});
  }

  console.log("הצלחה: הסיסמה הוגדרה ל-strauss_notifier, NOTIFY_DATABASE_URL עודכן, ואומת היקף מצומצם (notification_jobs בלבד, ללא cases).");
  console.log("לא הודפסו סיסמאות או מחרוזות חיבור.");
}

main().catch((e) => {
  // לא מדפיסים את מחרוזת החיבור/סיסמה; רק הודעת השגיאה הכללית.
  console.error("כשל בהגדרת הסיסמה:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});