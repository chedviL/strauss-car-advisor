// src/server/repositories/pg-case-repository.ts
// מימוש CaseRepository מול Postgres (Supabase) עם אכיפת RLS אמיתית.
// כל פעולה רצה בטרנזקציה עם SET LOCAL app.owner_id, כך שפוליסות ה-RLS
// במיגרציה 0001 מסננות כל שאילתה. owner_id מוזרק מהשרת בלבד.

import { randomUUID } from "node:crypto";
import { type Pool, type PoolClient } from "pg";
import { getPool } from "./pg-pool.js";
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
  StoredMessage,
  StoredCompareRun,
} from "./case-repository.js";

export class PgCaseRepository implements CaseRepository {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = getPool(connectionString);
  }

  // ה-pool משותף ו-per-process; close() הוא no-op (לא סוגרים pool משותף).
  async close(): Promise<void> {
    /* shared pool - do not end here */
  }

  private static isConnError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /terminated|ECONNRESET|EPIPE|Connection terminated|server closed|timeout|Client has encountered a connection error/i.test(
      msg,
    );
  }

  private async withOwner<T>(
    ownerId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    // ה-transaction pooler של Supabase סוגר חיבורים idle; חיבור מת מה-pool
    // עלול להיכשל כבר ב-connect() או ב-begin. עוטפים את כל מחזור החיים
    // (connect+use+release) ומנסים עד 3 פעמים עם חיבור טרי בכשל חיבור.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      let client: PoolClient | null = null;
      try {
        client = await this.pool.connect();
        await client.query("begin");
        await client.query("select set_config('app.owner_id', $1, true)", [ownerId]);
        const result = await fn(client);
        await client.query("commit");
        client.release();
        return result;
      } catch (err) {
        lastErr = err;
        if (client) {
          try {
            await client.query("rollback");
          } catch {
            /* חיבור כבר מת - אין מה לגלגל אחורה */
          }
          client.release(true); // destroy: מסיר חיבור פגום מה-pool
        }
        if (attempt < 2 && PgCaseRepository.isConnError(err)) {
          // המתנה קצרה כדי לאפשר ל-pool להחליף את החיבור המת.
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
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

  async computeComparisonTxn(
    caseId: string,
    ownerId: string,
    compute: (state: CaseState) => import("./case-repository.js").ComputeTxnOutcome,
  ): Promise<import("./case-repository.js").ComparisonTxnResult> {
    // טרנזקציה אחת: טעינת מצב + compute סינכרוני (ללא I/O) + INSERT.
    // חוסך טרנזקציה שנייה, set_config כפול, ו-select כפול של dataset_id.
    return this.withOwner(ownerId, async (c) => {
      // ללא select נפרד לבדיקת קיום: loadState קורא מ-cases ממילא. RLS אוכף
      // בעלות (set_config). אם אין תיק (null) - נזרקת שגיאה מתוך loadState.
      const state = await this.loadStateOrThrow(c, caseId);
      const outcome = compute(state);
      if (outcome.status !== "ok") return outcome;
      const rec = outcome.record;
      const id = randomUUID();
      const r = await c.query(
        `insert into comparisons (id, case_id, baseline_scenario_id, alternative_scenario_id,
           dataset_id, rule_set_hash, facts_revision, input_snapshot, result, request_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [id, caseId, rec.baselineScenarioId, rec.alternativeScenarioId, state.case.datasetId,
          rec.ruleSetHash, rec.factsRevision,
          JSON.stringify(rec.inputSnapshot), JSON.stringify(rec.result), null],
      );
      await c.query("update cases set updated_at = now() where id = $1", [caseId]);
      return { status: "ok", comparison: mapComparison(r.rows[0]) };
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

  async answerInquiry(
    inquiryId: string,
    ownerId: string,
    answer: { value: number | null; note: string | null; effectiveFrom: string | null },
  ): Promise<InquiryRecord> {
    return this.withOwner(ownerId, async (c) => {
      const r = await c.query(
        `update inquiries
            set status = 'answered', answer_value = $2, answer_note = $3,
                effective_from = $4, answered_at = now()
          where id = $1 returning *`,
        [inquiryId, answer.value, answer.note, answer.effectiveFrom],
      );
      if (r.rowCount === 0) throw new Error("inquiry not found for owner");
      return mapInquiry(r.rows[0]);
    });
  }

  async appendMessages(
    caseId: string,
    ownerId: string,
    messages: Array<{ role: string; clientMessageId: string | null; content: unknown }>,
  ): Promise<void> {
    if (messages.length === 0) return;
    await this.withOwner(ownerId, async (c) => {
      const maxRow = await c.query(
        "select coalesce(max(seq), -1) as m from messages where case_id = $1",
        [caseId],
      );
      let seq = (maxRow.rows[0].m as number) + 1;
      for (const m of messages) {
        // dedup לפי client_message_id (אם קיים) כדי לא לשכפל בשליחה חוזרת.
        await c.query(
          `insert into messages (case_id, role, seq, client_message_id, content)
           values ($1,$2,$3,$4,$5)
           on conflict (case_id, client_message_id) do nothing`,
          [caseId, m.role, seq, m.clientMessageId, JSON.stringify(m.content)],
        );
        seq += 1;
      }
    });
  }

  async loadMessages(caseId: string, ownerId: string): Promise<StoredMessage[]> {
    return this.withOwner(ownerId, async (c) => {
      const r = await c.query(
        "select id, role, seq, client_message_id, content, created_at from messages where case_id = $1 order by seq",
        [caseId],
      );
      return r.rows.map((m) => ({
        id: m.id as string,
        role: m.role as string,
        seq: m.seq as number,
        clientMessageId: (m.client_message_id as string) ?? null,
        content: m.content,
        createdAt: iso(m.created_at),
      }));
    });
  }

  async saveCompareRun(
    caseId: string,
    ownerId: string,
    run: { factsRevision: number; ruleSetHash: string; mode: string; ranking: string; result: unknown },
  ): Promise<string> {
    return this.withOwner(ownerId, async (c) => {
      const r = await c.query(
        `insert into compare_runs (case_id, facts_revision, rule_set_hash, mode, ranking, result)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [caseId, run.factsRevision, run.ruleSetHash, run.mode, run.ranking, JSON.stringify(run.result)],
      );
      return r.rows[0].id as string;
    });
  }

  async loadCompareRun(caseId: string, ownerId: string, runId: string): Promise<StoredCompareRun | null> {
    return this.withOwner(ownerId, async (c) => {
      const r = await c.query(
        "select * from compare_runs where id = $1 and case_id = $2",
        [runId, caseId],
      );
      if (r.rowCount === 0) return null;
      const row = r.rows[0];
      return {
        id: row.id as string,
        factsRevision: row.facts_revision as number,
        ruleSetHash: row.rule_set_hash as string,
        mode: row.mode as string,
        ranking: row.ranking as string,
        result: row.result,
        createdAt: iso(row.created_at),
      };
    });
  }

  /**
   * טוען את כל מצב התיק ב-round-trip יחיד (במקום 5 שאילתות רצופות).
   * כל טבלה נאספת כ-JSON; מקצץ עלות רשת מהותית מול pooler מרוחק.
   */
  /** כמו loadState אך זורק אם התיק לא קיים/לא בבעלות (row.case = null). */
  private async loadStateOrThrow(c: PoolClient, caseId: string): Promise<CaseState> {
    const state = await this.loadState(c, caseId);
    return state;
  }

  private async loadState(c: PoolClient, caseId: string): Promise<CaseState> {
    const r = await c.query(
      `select
         (select to_jsonb(x) from (select * from cases where id = $1) x) as case,
         (select to_jsonb(x) from (select * from case_facts where case_id = $1) x) as facts,
         coalesce((select jsonb_agg(to_jsonb(x)) from (select * from scenarios where case_id = $1) x), '[]'::jsonb) as scenarios,
         (select to_jsonb(x) from (select * from comparisons where case_id = $1 order by completed_at desc limit 1) x) as latest_comparison,
         coalesce((select jsonb_agg(to_jsonb(x)) from (select * from inquiries where case_id = $1 and status in ('open','answered') order by created_at) x), '[]'::jsonb) as open_inquiries`,
      [caseId],
    );
    const row = r.rows[0];
    if (!row || row.case === null) {
      throw new Error("case not found for owner");
    }
    return {
      case: mapCase(row.case),
      facts: mapFacts(row.facts),
      scenarios: (row.scenarios as Record<string, unknown>[]).map(mapScenario),
      latestComparison: row.latest_comparison ? mapComparison(row.latest_comparison) : null,
      openInquiries: (row.open_inquiries as Record<string, unknown>[]).map(mapInquiry),
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
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}
// עמיד גם ל-Date (שורת pg גולמית) וגם ל-ISO string (פלט to_jsonb).
function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : new Date(v as string).toISOString();
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
    completedAt: iso(r.completed_at),
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
    createdAt: iso(r.created_at),
    answerValue: num(r.answer_value),
    answerNote: (r.answer_note as string) ?? null,
    effectiveFrom: r.effective_from ? iso(r.effective_from).slice(0, 10) : null,
    answeredAt: r.answered_at ? iso(r.answered_at) : null,
  };
}