// src/server/services/dataset-provider.ts
// טעינה וקאשינג של גרסת הנתונים הפעילה: כללים + קטלוג פתור.
// הכללים המעודכנים (strauss-rules.json) הם הפעילים.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseRules } from "../../domain/calculation/rule-set-loader.js";
import {
  parseValueOfUseCsv,
  type ValueOfUseIndex,
} from "../repositories/value-of-use-import.js";
import {
  importCatalog,
  type ResolvedVehicle,
} from "../repositories/catalog-import.js";
import { CATALOG } from "../../../data/source/catalog.js";
import { DatasetRepository, datasetContentHash, type DatasetSeed } from "../repositories/dataset-repository.js";
import type { RuleSet } from "../../domain/contracts/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "../../../data/source");

export interface ActiveDataset {
  /** מזהה תוכן (hash) - יציב, לשימוש פנימי/קאשינג. אינו ה-UUID של רשומת המסד. */
  contentId: string;
  rules: RuleSet;
  rawRulesJson: string;
  appliedDefaults: string[];
  vehiclesByCode: Map<string, ResolvedVehicle>;
  /** אינדקס ה-CSV המלא - קיים רק במסלול הקבצים; במסלול ה-DB אינו נדרש. */
  valueOfUse?: ValueOfUseIndex;
  datasetId?: string;
}

let cached: ActiveDataset | null = null;

export function getActiveDataset(): ActiveDataset {
  if (cached) return cached;
  const rawRulesJson = readFileSync(join(dataDir, "strauss-rules.json"), "utf8");
  const rulesText = rawRulesJson;
  const { rules, appliedDefaults } = parseRules(rulesText);
  const valueOfUse = parseValueOfUseCsv(
    readFileSync(join(dataDir, "value-of-use-2026.csv")),
  );
  const { resolved, blocked } = importCatalog(CATALOG, valueOfUse);
  if (blocked.length > 0) {
    throw new Error(
      `dataset לא תקין: ${blocked.length} רכבים חסומים: ${blocked.map((b) => b.id).join(", ")}`,
    );
  }
  const vehiclesByCode = new Map(resolved.map((v) => [v.id, v]));
  cached = {
    contentId: rules.contentHash.slice(0, 16),
    rules,
    rawRulesJson,
    appliedDefaults,
    vehiclesByCode,
    valueOfUse,
  };
  return cached;
}

/** בונה את ה-seed ל-DatasetRepository מתוך ה-dataset המחושב. */
export function buildDatasetSeed(ds: ActiveDataset): DatasetSeed {
  if (!ds.valueOfUse) {
    throw new Error(
      "buildDatasetSeed דורש dataset מגובה-CSV (valueOfUse). השתמש ב-getActiveDataset() בלבד למסלול היבוא.",
    );
  }
  return {
    rules: ds.rules,
    rawRulesJson: ds.rawRulesJson,
    vehicles: [...ds.vehiclesByCode.values()],
    valueOfUseSource: ds.rules.valueOfUse.source,
    valueOfUseRowCount: ds.valueOfUse.rowCount,
  };
}

// קאש ל-UUID האמיתי של ה-dataset במסד (לכל process).
let datasetUuidCache: string | null = null;

/**
 * מחזיר את ה-UUID האמיתי של רשומת ה-dataset במסד, מייבא אם צריך (idempotent).
 * דורש connection עם הרשאות כתיבה (בעלים/מיגרציה). מיועד למסלול הפעיל מול Postgres.
 */
export async function ensureActiveDatasetId(ownerConnectionString: string): Promise<string> {
  if (datasetUuidCache) return datasetUuidCache;
  const ds = getActiveDataset();
  const repo = new DatasetRepository(ownerConnectionString);
  try {
    datasetUuidCache = await repo.ensureDataset(buildDatasetSeed(ds));
    return datasetUuidCache;
  } finally {
    await repo.close();
  }
}

/**
 * חיפוש read-only של ה-UUID לפי content hash, בחיבור כלשהו (למשל תפקיד האפליקציה).
 * מחזיר null אם ה-dataset טרם יובא (אז יש להריץ import:dataset).
 */
export async function findActiveDatasetId(connectionString: string): Promise<string | null> {
  if (datasetUuidCache) return datasetUuidCache;
  // ללא פענוח CSV: מזהים לפי content_hash של הכללים (קובץ JSON קטן בלבד).
  const { rules } = loadRulesOnly();
  const repo = new DatasetRepository(connectionString);
  try {
    const id = await repo.findDatasetIdByRuleSetHash(rules.contentHash);
    if (id) datasetUuidCache = id;
    return id;
  } finally {
    await repo.close();
  }
}

// ===== מסלול מהיר מול Postgres: ללא פענוח CSV בזמן ריצה =====

import { DatasetRepository as _DatasetRepo } from "../repositories/dataset-repository.js";

let dbDatasetCache: ActiveDataset | null = null;

function loadRulesOnly(): { rules: RuleSet; appliedDefaults: string[]; rawRulesJson: string } {
  const rawRulesJson = readFileSync(join(dataDir, "strauss-rules.json"), "utf8");
  const { rules, appliedDefaults } = parseRules(rawRulesJson);
  return { rules, appliedDefaults, rawRulesJson };
}

/**
 * dataset פעיל מגובה-מסד: כללים מה-JSON הקטן + 20 רכבים מ-Postgres (שאילתה זעירה).
 * אינו מפרסר את ה-CSV בן ה-19MB. נדרש dataset מיובא (import:dataset).
 */
export async function getActiveDatasetFromDb(connectionString: string): Promise<ActiveDataset> {
  if (dbDatasetCache) return dbDatasetCache;
  // כללים מה-JSON הקטן (ארוז עם הפונקציה דרך outputFileTracingIncludes), ורכבים
  // מ-Postgres. הקובץ הוא מקור האמת לזיהוי גרסה (content hash); המסד מאחסן עותק.
  const { rules, appliedDefaults, rawRulesJson } = loadRulesOnly();
  const repo = new _DatasetRepo(connectionString);
  try {
    const datasetId = await findActiveDatasetId(connectionString);
    if (!datasetId) {
      throw new Error("ה-dataset הפעיל טרם יובא למסד. הרץ: npm run import:dataset.");
    }
    const vehicles = await repo.loadDatasetVehicles(datasetId);
    if (vehicles.length === 0) {
      throw new Error("ל-dataset אין רכבים במסד. הרץ מחדש: npm run import:dataset.");
    }
    dbDatasetCache = {
      contentId: rules.contentHash.slice(0, 16),
      rules,
      rawRulesJson,
      appliedDefaults,
      vehiclesByCode: new Map(vehicles.map((v) => [v.id, v])),
      datasetId,
    };
    return dbDatasetCache;
  } finally {
    await repo.close();
  }
}
