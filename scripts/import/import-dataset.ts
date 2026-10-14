// scripts/import/import-dataset.ts
// יבוא reproducible: טוען כללים, מאגר שווי שימוש וקטלוג, מכריע קודי סוג רכב,
// ומפיק דוח אימות (validation report). AC-9.1.2, AC-2.1.7.
// הרצה: npm run import:data

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseRules } from "../../src/domain/calculation/rule-set-loader.js";
import {
  parseValueOfUseCsv,
} from "../../src/server/repositories/value-of-use-import.js";
import {
  importCatalog,
  verifyResolvedKey,
} from "../../src/server/repositories/catalog-import.js";
import { CATALOG } from "../../data/source/catalog.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "../../data/source");

function main(): void {
  const rulesText = readFileSync(join(dataDir, "strauss-rules.json"), "utf8");
  const { rules, appliedDefaults } = parseRules(rulesText);

  const csvBytes = readFileSync(join(dataDir, "value-of-use-2026.csv"));
  const index = parseValueOfUseCsv(csvBytes);

  const { resolved, blocked } = importCatalog(CATALOG, index);
  const keyVerified = resolved.filter((v) => verifyResolvedKey(v, index));

  const report = {
    generatedAt: new Date().toISOString(),
    ruleSet: {
      version: rules.version,
      contentHash: rules.contentHash,
      appliedDefaults,
      contributionsBase: rules.netMethod.contributionsBase,
      pensionCredit: rules.netMethod.pensionCredit,
      rounding: rules.netMethod.rounding,
      participation: rules.netMethod.participation,
    },
    valueOfUse: {
      source: rules.valueOfUse.source,
      rowCount: index.rowCount,
      duplicateKeys: index.duplicates.length,
      keyParts: rules.valueOfUse.key,
    },
    catalog: {
      total: CATALOG.length,
      resolved: resolved.length,
      blocked: blocked.length,
      keyVerified: keyVerified.length,
      blockedDetails: blocked,
      vehicles: resolved.map((v) => ({
        id: v.id,
        group: v.group,
        vehicleTypeCode: v.vehicleTypeCode,
        valueOfUse: v.valueOfUse,
        propulsion: v.propulsion,
        typeResolutionSource: v.typeResolutionSource,
      })),
    },
  };

  const outPath = join(dataDir, "import-validation-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log("=== דוח יבוא ===");
  console.log(`rule-set version=${rules.version} hash=${rules.contentHash.slice(0, 12)}...`);
  console.log(`ברירות מחדל שהופעלו: ${appliedDefaults.length}`);
  console.log(`שווי שימוש: ${index.rowCount} רשומות, ${index.duplicates.length} כפילויות מפתח`);
  console.log(`קטלוג: ${resolved.length}/${CATALOG.length} נפתרו, ${blocked.length} חסומים, ${keyVerified.length} אומתו במפתח`);
  if (blocked.length > 0) {
    console.log("רכבים חסומים:");
    for (const b of blocked) console.log(`  - ${b.id}: ${b.reason}`);
    process.exitCode = 1; // AC-2.1.7: לא לפרסם dataset עם רכב עמום
  }
  console.log(`דוח מלא נכתב ל: ${outPath}`);
}

main();