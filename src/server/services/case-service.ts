// src/server/services/case-service.ts
// שירות אפליקציה משותף (UI + סוכן + worker). מגשר בין repository למנוע הטהור.
// המנוע נשאר טהור; השירות מרכיב CompleteInput מהעובדות, התרחיש וה-dataset.

import { calculateScenario } from "../../domain/calculation/engine.js";
import type {
  CompleteInput,
  ScenarioResult,
} from "../../domain/contracts/types.js";
import type {
  CaseFacts,
  CaseState,
  ComparisonRecord,
  Scenario,
} from "../../domain/contracts/case.js";
import type {
  CaseRepository,
  CreateScenarioInput,
} from "../repositories/case-repository.js";
import { getActiveDataset, type ActiveDataset } from "./dataset-provider.js";
import {
  SAMPLE_EMPLOYEES,
  type SampleEmployee,
} from "../../../data/source/sample-employees.js";

export interface ResolveResult {
  status: "ok" | "missing_data";
  input?: CompleteInput;
  missingFields?: string[];
}

/** מרכיב CompleteInput מעובדות התיק, התרחיש וה-dataset. אין undefined כאפס. */
export function resolveScenarioInput(
  facts: CaseFacts,
  scenario: Scenario,
  dataset: ActiveDataset,
): ResolveResult {
  const missing: string[] = [];
  const req = (v: number | null, name: string): number => {
    if (v === null || v === undefined) {
      missing.push(name);
      return 0;
    }
    return v;
  };

  const baseSalary = req(facts.baseSalary, "baseSalary");
  const commission = req(facts.commission, "commission");
  const bonus = req(facts.bonus, "bonus");
  const pensionRate = req(facts.pensionRate, "pensionRate");
  const trainingRate = req(facts.trainingRate, "trainingRate");
  const creditPoints = req(facts.creditPoints, "creditPoints");
  if (!facts.reportedGroup) missing.push("reportedGroup");

  let valueOfUse = 0;
  let isElectric = false;
  let companyCarCost = 0;
  if (scenario.route !== "waiver") {
    if (!scenario.vehicleCode) {
      missing.push("vehicleCode");
    } else {
      const v = dataset.vehiclesByCode.get(scenario.vehicleCode);
      if (!v) {
        missing.push("vehicle:" + scenario.vehicleCode);
      } else {
        valueOfUse = Number(v.valueOfUse);
        isElectric = v.propulsion === 3;
        companyCarCost = v.companyCost;
      }
    }
  }

  if (missing.length > 0) {
    return { status: "missing_data", missingFields: missing };
  }

  const input: CompleteInput = {
    route: scenario.route,
    group: facts.reportedGroup!,
    baseSalary,
    commission,
    bonus,
    pensionRate,
    trainingRate,
    creditPoints,
    valueOfUse,
    isElectric,
    participation: scenario.participation ?? 0,
    companyCarCost,
    maintenanceAllowance: scenario.maintenanceAllowance,
  };
  return { status: "ok", input };
}

export function computeScenario(
  facts: CaseFacts,
  scenario: Scenario,
  dataset: ActiveDataset,
): { status: "ok"; result: ScenarioResult } | { status: "missing_data"; missingFields: string[] } {
  const resolved = resolveScenarioInput(facts, scenario, dataset);
  if (resolved.status !== "ok" || !resolved.input) {
    return { status: "missing_data", missingFields: resolved.missingFields ?? [] };
  }
  return { status: "ok", result: calculateScenario(resolved.input, dataset.rules) };
}

export class CaseService {
  constructor(private readonly repo: CaseRepository) {}

  listSampleEmployees(): SampleEmployee[] {
    return SAMPLE_EMPLOYEES;
  }

  /** יוצר תיק דגמה מעובד לדוגמה: עובדות + baseline (המצב הנוכחי). */
  async createDemoCaseFromEmployee(ownerId: string, employeeId: string): Promise<CaseState> {
    const emp = SAMPLE_EMPLOYEES.find((e) => e.id === employeeId);
    if (!emp) throw new Error("עובד לדוגמה לא נמצא");
    const dataset = getActiveDataset();
    const facts: CaseFacts = {
      occupationCode: emp.facts.occupationCode,
      reportedGroup: emp.facts.reportedGroup,
      baseSalary: emp.facts.baseSalary,
      commission: emp.facts.commission,
      bonus: emp.facts.bonus,
      pensionRate: emp.facts.pensionRate,
      trainingRate: emp.facts.trainingRate,
      creditPoints: emp.facts.creditPoints,
      qualifyingChildren: emp.facts.qualifyingChildren,
    };
    const baseline: CreateScenarioInput = {
      role: "baseline",
      route: emp.baseline.route,
      vehicleCode: emp.baseline.vehicleCode,
      participation: emp.baseline.participation,
      maintenanceAllowance: emp.baseline.maintenanceAllowance,
    };
    return await this.repo.createCase({
      ownerId,
      isDemo: true,
      datasetId: dataset.datasetId,
      facts,
      baseline,
    });
  }

  async getCaseState(caseId: string, ownerId: string): Promise<CaseState | null> {
    return await this.repo.getCaseState(caseId, ownerId);
  }

  async pickAlternative(
    caseId: string,
    ownerId: string,
    alt: CreateScenarioInput,
  ): Promise<Scenario> {
    return await this.repo.upsertAlternative(caseId, ownerId, {
      ...alt,
      role: "alternative",
    });
  }

  /** מחשב baseline מול alternative, שומר השוואה immutable, ומחזיר אותה. */
  async computeAndSaveComparison(
    caseId: string,
    ownerId: string,
  ): Promise<{ status: "ok"; comparison: ComparisonRecord } | { status: "missing_data"; missingFields: string[] } | { status: "no_alternative" }> {
    const state = await this.repo.getCaseState(caseId, ownerId);
    if (!state) throw new Error("תיק לא נמצא לבעלים");
    const dataset = getActiveDataset();
    const baseline = state.scenarios.find((s) => s.role === "baseline");
    const alternative = state.scenarios.find((s) => s.role === "alternative");
    if (!baseline) throw new Error("אין baseline לתיק");
    if (!alternative) return { status: "no_alternative" };

    const b = computeScenario(state.facts, baseline, dataset);
    const a = computeScenario(state.facts, alternative, dataset);
    if (b.status !== "ok") return { status: "missing_data", missingFields: b.missingFields };
    if (a.status !== "ok") return { status: "missing_data", missingFields: a.missingFields };

    const netDeltaDisplay =
      Number(a.result.netDisplay) - Number(b.result.netDisplay);

    const comparison = await this.repo.saveComparison(caseId, ownerId, {
      caseId,
      baselineScenarioId: baseline.id,
      alternativeScenarioId: alternative.id,
      ruleSetHash: dataset.rules.contentHash,
      factsRevision: state.case.factsRevision,
      inputSnapshot: { baseline, alternative },
      result: {
        baseline: b.result,
        alternative: a.result,
        netDeltaDisplay,
      },
    });
    return { status: "ok", comparison };
  }
}