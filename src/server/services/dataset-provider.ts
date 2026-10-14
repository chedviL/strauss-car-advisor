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
import type { RuleSet } from "../../domain/contracts/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "../../../data/source");

export interface ActiveDataset {
  datasetId: string;
  rules: RuleSet;
  appliedDefaults: string[];
  vehiclesByCode: Map<string, ResolvedVehicle>;
  valueOfUse: ValueOfUseIndex;
}

let cached: ActiveDataset | null = null;

export function getActiveDataset(): ActiveDataset {
  if (cached) return cached;
  const rulesText = readFileSync(join(dataDir, "strauss-rules.json"), "utf8");
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
    // datasetId יציב הנגזר מ-hash הכללים (זיהוי גרסה לפי תוכן).
    datasetId: rules.contentHash.slice(0, 16),
    rules,
    appliedDefaults,
    vehiclesByCode,
    valueOfUse,
  };
  return cached;
}