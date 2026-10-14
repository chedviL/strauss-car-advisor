// src/server/repositories/pg-case-repository.ts
// מימוש CaseRepository מול Postgres (Supabase) עם אכיפת RLS אמיתית.
// כל פעולה רצה בטרנזקציה עם SET LOCAL app.owner_id, כך שפוליסות ה-RLS
// במיגרציה 0001 מסננות כל שאילתה. owner_id מוזרק מהשרת בלבד.

import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { sslFor } from "./pg-ssl.js";
import type {
  CaseFacts,
  InquiryRecord,
  InquiryType,
  ScenarioOverrides,
  CaseRecord,
  CaseState,
  ComparisonRecord,
  Scenario,
} from "../../domain/contracts/case.js";
import type {
  CaseRepository,
  CreateScenarioInput,
  FactsPatch,
  UpdateFactsOutcome,
} from "./case-repository.js";

export class PgCaseRepository implements CaseRepository {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5, ...sslFor(connectionString) });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async withOwner<T>(
    ownerId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.owner_id', $1, true)", [ownerId]);
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async createCase(input: {
    ownerId: string;
    isDemo: boolean;
    datasetId: string;
    facts: CaseFacts;
    baseline: CreateScenarioInput;
  }): Promise<CaseState> {
    if (input.baseline.role !== "baseline") {
      throw new Error("baseline scenario must have role=baseline");
    }
    return this.withOwner(input.ownerId, async (c) => {
      const caseRow = await c.query(
        `insert into cases (owner_id, is_demo, dataset_id, status, facts_revision)
         values ($1,$2,$3,'active',0) returning id`,
        [input.ownerId, input.isDemo, input.datasetId],
      );
      const caseId = caseRow.rows[0].id as string;
      const f = input.facts;
      await c.query(
        `insert into case_facts (case_id, occupation_code, reported_group, base_salary,
          commission, bonus, pension_rate, training_rate, credit_points, qualifying_children)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [caseId, f.occupationCode, f.reportedGroup, f.baseSalary, f.commission, f.bonus,
          f.pensionRate, f.trainingRate, f.creditPoints, f.qualifyingChildren],
      );
      const b = input.baseline;
      await c.query(
        `insert into scenarios (id, case_id, role, route, vehicle_code, participation, maintenance_allowance, overrides, revision)
         values ($1,$2,'baseline',$3,$4,$5,$6,$7,0)`,
        [randomUUID(), caseId, b.route, b.vehicleCode, b.participation, b.maintenanceAllowance, JSON.stringify(b.overrides ?? {})],
      );
      return this.loadState(c, caseId);
    });
  }

  async getCaseState(caseId: string, ownerId: string): Promise<CaseState | null> {
    return this.withOwner(ownerId, async (c) => {
      const exists = await c.query("select 1 from cases where id = $1", [caseId]);
      if (exists.rowCount === 0) return null;
      return this.loadState(c, caseId);
    });
  }

  async listCasesByOwner(ownerId: string): Promise<CaseRecord[]> {
    return this.withOwner(ownerId, async (c) => {
      const r = await c.query("select * from cases order by updated_at desc");
      return r.rows.map(mapCase);
    });
  }

  async upsertAlternative(
    caseId: string,
    ownerId: string,
    input: CreateScenarioInput,
  ): Promise<Scenario> {
    if (input.role !== "alternative") {
      throw new Error("upsertAlternative requires role=alternative");
    }
    return this.withOwner(ownerId, async (c) => {
      const owned = await c.query("select 1 from cases where id = $1", [caseId]);
      if (owned.rowCount === 0) throw new Error("case not found for owner");
      const existing = await c.query(
        "select * from scenarios where case_id = $1 and role = 'alternative'",
        [caseId],
      );
      if (existing.rowCount && existing.rows[0]) {
        const prev = existing.rows[0];
        const r = await c.query(
          `update scenarios set route=$2, vehicle_code=$3, participation=$4,
             maintenance_allowance=$5, overrides=$6, revision=revision+1
           where id=$1 returning *`,
          [prev.id, input.route, input.vehicleCode, input.participation, input.maintenanceAllowance, JSON.stringify(input.overrides ?? {})],
        );
        await c.query("update cases set updated_at = now() where id = $1", [caseId]);
        return mapScenario(r.rows[0]);
      }
      const r = await c.query(
        `insert into scenarios (id, case_id, role, route, vehicle_code, participation, maintenance_allowance, overrides, revision)
         values ($1,$2,'alternative',$3,$4,$5,$6,$7,0) returning *`,
        [randomUUID(), caseId, input.route, input.vehicleCode, input.participation, input.maintenanceAllowance, JSON.stringify(input.overrides ?? {})],
      );
      await c.query("update cases set updated_at = now() where id = $1", [caseId]);
      return mapScenario(r.rows[0]);
    });
  }

  async saveComparison(
    caseId: string,
    ownerId: string,
    record: Omit<ComparisonRecord, "id" | "completedAt">,
  ): Promise<ComparisonRecord> {
    return this.withOwner(ownerId, async (c) => {
      const owned = await c.query("select dataset_id from cases where id = $1", [caseId]);
      if (owned.rowCount === 0) throw new Error("case not found for owner");
      const datasetId = owned.rows[0].dataset_id as string;
      const id = randomUUID();
      const r = await c.query(
        `insert into comparisons (id, case_id, baseline_scenario_id, alternative_scenario_id,
           dataset_id, rule_set_hash, facts_revision, input_snapshot, result, request_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [id, caseId, record.baselineScenarioId, record.alternativeScenarioId, datasetId,
          record.ruleSetHash, record.factsRevision,
          JSON.stringify(record.inputSnapshot), JSON.stringify(record.result), null],
      );
      await c.query("update cases set updated_at = now() where id = $1", [caseId]);
      return mapComparison(r.rows[0]);
    });
  }

  async updateFacts(
    caseId: string,
    ownerId: string,
    patch: FactsPatch,
    expectedRevision: number,
  ): Promise<UpdateFactsOutcome> {
    return this.withOwner(ownerId, async (c) => {
      const cur = await c.query("select facts_revision from cases where id = $1", [caseId]);
      if (cur.rowCount === 0) throw new Error("case not found for owner");
      const currentRevision = cur.rows[0].facts_revision as number;
      if (currentRevision !== expectedRevision) {
        return { status: "conflict", currentRevision };
      }
      const cols: Record<string, string> = {
        occupationCode: "occupation_code", reportedGroup: "reported_group",
        baseSalary: "base_salary", commission: "commission", bonus: "bonus",
        pensionRate: "pension_rate", trainingRate: "training_rate",
        creditPoints: "credit_points", qualifyingChildren: "qualifying_children",
      };
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        const col = cols[k];
        if (!col) continue;
        sets.push(`${col} = $${i++}`);
        vals.push(v);
      }
      if (sets.length === 0) {
        return { status: "ok", factsRevision: currentRevision };
      }
      vals.push(caseId);
      // זיהוי שינוי סמנטי: בודקים אם לפחות שדה אחד שונה בפועל.
      const changedCheck = await c.query(
        `select 1 from case_facts where case_id = $${i} and (` +
          Object.entries(patch)
            .filter(([, v]) => v !== undefined)
            .map(([k]) => `${cols[k]} is distinct from $${Object.keys(patch).filter((kk) => patch[kk as keyof FactsPatch] !== undefined).indexOf(k) + 1}`)
            .join(" or ") +
          ")",
        vals,
      );
      if (changedCheck.rowCount === 0) {
        return { status: "ok", factsRevision: currentRevision };
      }
      await c.query(`update case_facts set ${sets.join(", ")} where case_id = $${i}`, vals);
      const upd = await c.query(
        "update cases set facts_revision = facts_revision + 1, updated_at = now() where id = $1 returning facts_revision",
        [caseId],
      );
      return { status: "ok", factsRevision: upd.rows[0].facts_revision as number };
    });
  }

  async openInquiry(
    caseId: string,
    ownerId: string,
    input: { type: InquiryType; scenarioId: string | null; contextFingerprint: string },
  ): Promise<{ inquiry: InquiryRecord; deduped: boolean }> {
    return this.withOwner(ownerId, async (c) => {
      const owned = await c.query("select 1 from cases where id = $1", [caseId]);
      if (owned.rowCount === 0) throw new Error("case not found for owner");
      const existing = await c.query(
        `select * from inquiries where case_id=$1 and type=$2 and context_fingerprint=$3 and status='open'`,
        [caseId, input.type, input.contextFingerprint],
      );
      if (existing.rowCount && existing.rows[0]) {
        return { inquiry: mapInquiry(existing.rows[0]), deduped: true };
      }
      const r = await c.query(
        `insert into inquiries (case_id, scenario_id, type, context_fingerprint, status)
         values ($1,$2,$3,$4,'open') returning *`,
        [caseId, input.scenarioId, input.type, input.contextFingerprint],
      );
      return { inquiry: mapInquiry(r.rows[0]), deduped: false };
    });
  }

  private async loadState(c: PoolClient, caseId: string): Promise<CaseState> {
    const caseRow = await c.query("select * from cases where id = $1", [caseId]);
    const factsRow = await c.query("select * from case_facts where case_id = $1", [caseId]);
    const scenRows = await c.query("select * from scenarios where case_id = $1", [caseId]);
    const cmpRows = await c.query(
      "select * from comparisons where case_id = $1 order by completed_at desc limit 1",
      [caseId],
    );
    const inqRows = await c.query(
      "select * from inquiries where case_id = $1 and status = 'open'",
      [caseId],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    return {
      case: mapCase(caseRow.rows[0]),
      facts: mapFacts(factsRow.rows[0]),
      scenarios: scenRows.rows.map(mapScenario),
      latestComparison:
        cmpRows.rowCount && cmpRows.rows[0] ? mapComparison(cmpRows.rows[0]) : null,
      openInquiries: inqRows.rows.map(mapInquiry),
    };
  }
}

function mapCase(r: Record<string, unknown>): CaseRecord {
  return {
    id: r.id as string,
    ownerId: r.owner_id as string,
    isDemo: r.is_demo as boolean,
    datasetId: r.dataset_id as string,
    status: r.status as CaseRecord["status"],
    factsRevision: r.facts_revision as number,
    createdAt: (r.created_at as Date).toISOString(),
    updatedAt: (r.updated_at as Date).toISOString(),
  };
}
function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}
function mapFacts(r: Record<string, unknown> | undefined): CaseFacts {
  if (!r) {
    return {
      occupationCode: null, reportedGroup: null, baseSalary: null, commission: null,
      bonus: null, pensionRate: null, trainingRate: null, creditPoints: null, qualifyingChildren: null,
    };
  }
  return {
    occupationCode: (r.occupation_code as string) ?? null,
    reportedGroup: (r.reported_group as string) ?? null,
    baseSalary: num(r.base_salary),
    commission: num(r.commission),
    bonus: num(r.bonus),
    pensionRate: num(r.pension_rate),
    trainingRate: num(r.training_rate),
    creditPoints: num(r.credit_points),
    qualifyingChildren: num(r.qualifying_children),
  };
}
function mapScenario(r: Record<string, unknown>): Scenario {
  return {
    id: r.id as string,
    caseId: r.case_id as string,
    role: r.role as Scenario["role"],
    route: r.route as Scenario["route"],
    vehicleCode: (r.vehicle_code as string) ?? null,
    participation: num(r.participation),
    maintenanceAllowance: Number(r.maintenance_allowance),
    overrides: (r.overrides as ScenarioOverrides) ?? {},
    revision: r.revision as number,
  };
}
function mapComparison(r: Record<string, unknown>): ComparisonRecord {
  return {
    id: r.id as string,
    caseId: r.case_id as string,
    baselineScenarioId: r.baseline_scenario_id as string,
    alternativeScenarioId: r.alternative_scenario_id as string,
    ruleSetHash: r.rule_set_hash as string,
    factsRevision: r.facts_revision as number,
    inputSnapshot: r.input_snapshot as ComparisonRecord["inputSnapshot"],
    result: r.result as ComparisonRecord["result"],
    completedAt: (r.completed_at as Date).toISOString(),
  };
}

function mapInquiry(r: Record<string, unknown>): InquiryRecord {
  return {
    id: r.id as string,
    caseId: r.case_id as string,
    type: r.type as InquiryType,
    scenarioId: (r.scenario_id as string) ?? null,
    contextFingerprint: r.context_fingerprint as string,
    status: r.status as InquiryRecord["status"],
    createdAt: (r.created_at as Date).toISOString(),
  };
}