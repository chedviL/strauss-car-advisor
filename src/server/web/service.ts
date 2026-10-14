// src/server/web/service.ts
// מופע שירות יחיד לצד שרת. בחירת repo לפי סביבה, עם כשל-הגדרה ברור:
// - DATABASE_URL מוגדר → PgCaseRepository (Postgres עם RLS). זהו מסלול הפרודקשן.
// - אין DATABASE_URL אך STRAUSS_ALLOW_FILE_STORE=1 → FileCaseRepository (דמו מקומי מפורש).
// - אחרת → שגיאת הגדרה ברורה. אין מעבר שקט לאחסון קבצים בסביבה פרוסה.

import { join } from "node:path";
import { FileCaseRepository } from "../repositories/case-repository.js";
import { PgCaseRepository } from "../repositories/pg-case-repository.js";
import { CaseService } from "../services/case-service.js";
import type { CaseRepository } from "../repositories/case-repository.js";

const stateDir = join(process.cwd(), "data", "state");

let singleton: CaseService | null = null;

export class ConfigError extends Error {}

function buildRepository(): CaseRepository {
  const url = process.env.DATABASE_URL;
  if (url && url.trim() !== "") {
    return new PgCaseRepository(url);
  }
  // אין DATABASE_URL. מותר אחסון קבצים רק כאופציה מקומית מפורשת.
  if (process.env.STRAUSS_ALLOW_FILE_STORE === "1") {
    return new FileCaseRepository(stateDir);
  }
  throw new ConfigError(
    "DATABASE_URL אינו מוגדר. בסביבה פרוסה נדרש חיבור Postgres. " +
      "לפיתוח מקומי בלבד אפשר להגדיר STRAUSS_ALLOW_FILE_STORE=1 לאחסון קבצים. " +
      "ראו README להגדרת משתני הסביבה.",
  );
}

export function caseService(): CaseService {
  if (!singleton) {
    singleton = new CaseService(buildRepository());
  }
  return singleton;
}