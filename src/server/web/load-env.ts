// src/server/web/load-env.ts
// טוען משתני סביבה מ-.env.local (קודם) ואז מ-.env, בלי להדפיס ערכים.
// לשימוש בסקריפטים (מיגרציות/בדיקות) ובכניסת השרת. אין הדפסת סודות.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const root = process.cwd();
  // סדר קדימות: .env.local גובר על .env. override=false => לא דורס משתנים שכבר הוגדרו בסביבה.
  for (const file of [".env.local", ".env"]) {
    const path = join(root, file);
    if (existsSync(path)) {
      config({ path, override: false });
    }
  }
}

/** מחזיר אילו משתני-מפתח הוגדרו (בוליאני בלבד; לא מדפיס ערכים). */
export function envPresence(keys: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const k of keys) out[k] = Boolean(process.env[k] && process.env[k]!.trim() !== "");
  return out;
}