// scripts/db/migrate.ts
// מריץ את המיגרציות ב-supabase/migrations לפי סדר, מול DATABASE_URL.
// הרצה: npm run db:migrate  (דורש DATABASE_URL בסביבה)

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "pg";
import { loadEnv, envPresence } from "../../src/server/web/load-env.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "../../supabase/migrations");

async function main(): Promise<void> {
  loadEnv();
  // המיגרציות רצות בתפקיד בעלים/אדמין (לא בתפקיד האפליקציה המוגבל).
  const presence = envPresence(["MIGRATION_DATABASE_URL", "DATABASE_URL"]);
  console.log("משתני סביבה (קיים/לא, ללא ערכים):", presence);
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("MIGRATION_DATABASE_URL (או DATABASE_URL) לא מוגדר. ראו README.");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `create table if not exists _migrations (
         name text primary key, applied_at timestamptz not null default now())`,
    );
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const done = await client.query("select 1 from _migrations where name = $1", [file]);
      if (done.rowCount && done.rowCount > 0) {
        console.log(`דילוג (כבר הורץ): ${file}`);
        continue;
      }
      const sql = readFileSync(join(migrationsDir, file), "utf8");
      console.log(`מריץ: ${file}`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into _migrations (name) values ($1)", [file]);
        await client.query("commit");
      } catch (e) {
        await client.query("rollback");
        throw e;
      }
    }
    console.log("כל המיגרציות הורצו בהצלחה.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("כשל במיגרציה:", e);
  process.exit(1);
});