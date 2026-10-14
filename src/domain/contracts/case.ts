// src/domain/contracts/case.ts
// חוזי מצב התיק (case/facts/scenario/comparison). משותפים ל-UI, סוכן ו-worker.

import type { RouteKind, ScenarioResult } from "./types.js";

export type ScenarioRole = "baseline" | "alternative";
export type CaseStatus = "active" | "archived";

export interface CaseFacts {
  occupationCode: string | null;
  reportedGroup: string | null;
  baseSalary: number | null;
  commission: number | null;
  bonus: number | null;
  pensionRate: number | null;
  trainingRate: number | null;
  creditPoints: number | null;
  qualifyingChildren: number | null;
}

export interface Scenario {
  id: string;
  caseId: string;
  role: ScenarioRole;
  route: RouteKind;
  vehicleCode: string | null;
  participation: number | null;
  maintenanceAllowance: number;
  revision: number;
}

export interface CaseRecord {
  id: string;
  ownerId: string;
  isDemo: boolean;
  datasetId: string;
  status: CaseStatus;
  factsRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ComparisonRecord {
  id: string;
  caseId: string;
  baselineScenarioId: string;
  alternativeScenarioId: string;
  ruleSetHash: string;
  factsRevision: number;
  inputSnapshot: {
    baseline: unknown;
    alternative: unknown;
  };
  result: {
    baseline: ScenarioResult;
    alternative: ScenarioResult;
    netDeltaDisplay: number;
  };
  completedAt: string;
}

export interface CaseState {
  case: CaseRecord;
  facts: CaseFacts;
  scenarios: Scenario[];
  latestComparison: ComparisonRecord | null;
}