// src/server/repositories/dataset-repository.ts
// יבוא dataset ל-Postgres באופן אידמפוטנטי, עם זיהוי גרסה לפי content hash.
// הרצה חוזרת מחזירה את אותה רשומת dataset (לא יוצרת כפילות) ואינה נוגעת
// בתיקים/השוואות קיימים. מחזיר את ה-UUID האמיתי של ה-dataset.

import { createHash } from "node:crypto";
import { type Pool, type PoolClient } from "pg";
import { getPool, withClient } from "./pg-pool.js";
import type { RuleSet } from "../../domain/contracts/types.js";
import type { ResolvedVehicle } from "./catalog-import.js";

export interface DatasetSeed {
  rules: RuleSet;
  rawRulesJson: string;
  vehicles: ResolvedVehicle[];
  valueOfUseSource: string;
  valueOfUseRowCount: number;
}

/** hash תוכן משולב: כללים + קטלוג פתור + מקור שווי שימוש. מזהה גרסה. */
export function datasetContentHash(seed: DatasetSeed): string {
  const h = createHash("sha256");
  h.update(seed.rules.contentHash);
  h.update("|vou:" + seed.valueOfUseSource + ":" + seed.valueOfUseRowCount);
  const cat = [...seed.vehicles]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((v) =>
      [v.id, v.vehicleTypeCode, v.valueOfUse, v.propulsion, v.companyCost, v.defaultParticipation].join(":"),
    )
    .join("|");
  h.update("|cat:" + cat);
  return h.digest("hex");
}

export class DatasetRepository {
  private readonly pool: Pool;
  private readonly conn: string;
  constructor(connectionString: string) {
    this.conn = connectionString;
    this.pool = getPool(connectionString);
  }
  // ה-pool משותף; close() הוא no-op.
  async close(): Promise<void> {
    /* shared pool - do not end here */
  }

  /**
   * מוודא שה-dataset קיים במסד (idempotent לפי content hash). מחזיר UUID.
   * דורש הרשאות כתיבה ל-rule_sets/datasets/vehicles - מריצים בחיבור הבעלים.
   */
  async ensureDataset(seed: DatasetSeed): Promise<string> {
    const contentHash = datasetContentHash(seed);
    const client = await this.pool.connect();
    try {
      await client.query("begin");

      // 1) rule_set לפי content_hash (ייחודי). אם קיים - משתמשים בו.
      const rs = await client.query(
        `insert into rule_sets (version, content_hash, config)
         values ($1, $2, $3::jsonb)
         on conflict (content_hash) do update set version = excluded.version
         returning id`,
        [seed.rules.version, seed.rules.contentHash, seed.rawRulesJson],
      );
      const ruleSetId = rs.rows[0].id as string;

      // 2) dataset לפי content hash המשולב. מחפשים קיים לפי validation_report->>hash.
      const existing = await client.query(
        `select id from datasets where validation_report->>'contentHash' = $1 limit 1`,
        [contentHash],
      );
      let datasetId: string;
      if (existing.rowCount && existing.rows[0]) {
        datasetId = existing.rows[0].id as string;
        await client.query("commit");
        return datasetId;
      }

      const ds = await client.query(
        `insert into datasets (rule_set_id, value_of_use_source, value_of_use_row_count, validation_report)
         values ($1, $2, $3, $4::jsonb) returning id`,
        [
          ruleSetId,
          seed.valueOfUseSource,
          seed.valueOfUseRowCount,
          JSON.stringify({ contentHash, vehicles: seed.vehicles.length }),
        ],
      );
      datasetId = ds.rows[0].id as string;

      // 3) vehicles ל-dataset החדש (idempotent לפי מפתח ראשי dataset_id+catalog_code).
      for (const v of seed.vehicles) {
        await this.insertVehicle(client, datasetId, v);
      }

      await client.query("commit");
      return datasetId;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * חיפוש read-only של dataset לפי content_hash של גרסת הכללים (ללא פענוח CSV).
   * מזהה את ה-dataset הפעיל התואם לכללים הנוכחיים. מחזיר את העדכני ביותר אם יש כמה.
   */
  async findDatasetIdByRuleSetHash(ruleSetHash: string): Promise<string | null> {
    return withClient(this.conn, async (client) => {
      const r = await client.query(
        `select d.id from datasets d
           join rule_sets r on r.id = d.rule_set_id
         where r.content_hash = $1
         order by d.imported_at desc
         limit 1`,
        [ruleSetHash],
      );
      return r.rowCount && r.rows[0] ? (r.rows[0].id as string) : null;
    });
  }

  /** חיפוש read-only של dataset לפי content hash (עובד בתפקיד האפליקציה). */
  async findDatasetIdByContentHash(contentHash: string): Promise<string | null> {
    return withClient(this.conn, async (client) => {
      const r = await client.query(
        `select id from datasets where validation_report->>'contentHash' = $1 limit 1`,
        [contentHash],
      );
      return r.rowCount && r.rows[0] ? (r.rows[0].id as string) : null;
    });
  }

  /**
   * טוען את ה-dataset הפעיל ישירות מהמסד (מקור האמת): ה-dataset העדכני ביותר,
   * ה-rawRulesJson השמור ב-rule_sets.config, ו-content_hash של גרסת הכללים.
   * ללא קריאת קבצים מקומיים - לפריסה (Vercel) שבה אין את קבצי המקור ארוזים.
   */
  async loadActiveDataset(): Promise<{ datasetId: string; rawRulesJson: string; ruleSetHash: string } | null> {
    return withClient(this.conn, async (client) => {
      const r = await client.query(
        `select d.id as dataset_id, r.config as config, r.content_hash as content_hash
           from datasets d
           join rule_sets r on r.id = d.rule_set_id
         order by d.imported_at desc
         limit 1`,
      );
      if (!r.rowCount || !r.rows[0]) return null;
      const cfg = r.rows[0].config;
      // config נשמר כ-jsonb מתוך rawRulesJson; מחזירים כמחרוזת לפרסור אחיד.
      const rawRulesJson = typeof cfg === "string" ? cfg : JSON.stringify(cfg);
      return {
        datasetId: r.rows[0].dataset_id as string,
        rawRulesJson,
        ruleSetHash: r.rows[0].content_hash as string,
      };
    });
  }

  /** טוען את רכבי ה-dataset מהמסד (20 שורות) - ללא פענוח CSV בזמן ריצה. */
  async loadDatasetVehicles(datasetId: string): Promise<ResolvedVehicle[]> {
    return withClient(this.conn, async (client) => {
      const r = await client.query(
        `select catalog_code, grp, manufacturer_code, model_code, registration_year,
                vehicle_type_code, value_of_use, propulsion, company_cost,
                default_participation, type_resolution_source, commercial_name
         from vehicles where dataset_id = $1 order by catalog_code`,
        [datasetId],
      );
      return r.rows.map((v) => ({
        id: v.catalog_code as string,
        group: v.grp as string,
        commercialName: (v.commercial_name as string) ?? "",
        manufacturerCode: v.manufacturer_code as string,
        modelCode: v.model_code as string,
        registrationYear: v.registration_year as string,
        vehicleTypeCode: v.vehicle_type_code as string,
        valueOfUse: String(v.value_of_use),
        propulsion: Number(v.propulsion) as 0 | 1 | 2 | 3,
        companyCost: Number(v.company_cost),
        defaultParticipation: Number(v.default_participation),
        typeResolutionSource: v.type_resolution_source as string,
      }));
    });
  }

  private async insertVehicle(
    client: PoolClient,
    datasetId: string,
    v: ResolvedVehicle,
  ): Promise<void> {
    await client.query(
      `insert into vehicles
         (dataset_id, catalog_code, grp, manufacturer_code, model_code, registration_year,
          vehicle_type_code, value_of_use, propulsion, company_cost, default_participation, type_resolution_source, commercial_name)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (dataset_id, catalog_code) do nothing`,
      [
        datasetId, v.id, v.group, v.manufacturerCode, v.modelCode, v.registrationYear,
        v.vehicleTypeCode, v.valueOfUse, v.propulsion, v.companyCost, v.defaultParticipation, v.typeResolutionSource, v.commercialName,
      ],
    );
  }
}