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
  valueOfUse: ValueOfUseIndex;
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
  const ds = getActiveDataset();
  const hash = datasetContentHash(buildDatasetSeed(ds));
  const repo = new DatasetRepository(connectionString);
  try {
    const id = await repo.findDatasetIdByContentHash(hash);
    if (id) datasetUuidCache = id;
    return id;
  } finally {
    await repo.close();
  }
}