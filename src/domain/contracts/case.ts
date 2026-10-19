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

/**
 * override היפותטי ברמת התרחיש. שדה ללא override יורש את העובדה המשותפת.
 * מותר רק לשדות שכר מוגדרים - לא קבוצת זכאות ולא עקיפת רכב חובה.
 * null מפורש אינו אפס; הסרת override מתבצעת ע"י השמטת המפתח (חזרה לירושה).
 */
export type ScenarioOverrides = Partial<{
  baseSalary: number;
  commission: number;
  bonus: number;
}>;

export interface Scenario {
  id: string;
  caseId: string;
  role: ScenarioRole;
  route: RouteKind;
  vehicleCode: string | null;
  participation: number | null;
  maintenanceAllowance: number;
  /** override היפותטי לשדות שכר. ריק = ירושה מלאה מהעובדות המשותפות. */
  overrides: ScenarioOverrides;
  revision: number;
}

/**
 * בקשה פעילה שממתינה להשלמת נתונים (למשל בקשת השוואה שנעצרה על מידע חסר).
 * ייצוג עמיד על התיק - שורד רענון והתארכות היסטוריה; מתנקה בשינוי כיוון/ביטול.
 */
export interface PendingRequest {
  kind: "compare";
  mode: "discover" | "explicit";
  vehicleCodes?: string[];
  propulsion?: string;
  includeWaiver?: boolean;
}

export interface CaseRecord {
  id: string;
  ownerId: string;
  isDemo: boolean;
  datasetId: string;
  status: CaseStatus;
  factsRevision: number;
  pendingRequest: PendingRequest | null;
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

export type InquiryType =
  | "employee_participation"
  | "occupation_eligibility_clarification";

export interface InquiryRecord {
  id: string;
  caseId: string;
  type: InquiryType;
  scenarioId: string | null;
  contextFingerprint: string;
  status: "open" | "answered" | "cancelled";
  createdAt: string;
  /** תשובת נציג (אם נענתה): ערך מספרי מובנה (למשל השתתפות ₪). */
  answerValue: number | null;
  /** הערה חופשית קצרה מהנציג. */
  answerNote: string | null;
  /** תחולה (ISO date) אם רלוונטי. */
  effectiveFrom: string | null;
  /** מתי נענתה (ISO) או null. */
  answeredAt: string | null;
}

/**
 * סטטוס זרימת התלוש של התיק (לסנכרון הקשר השיחה). משקף את המסמך העדכני ביותר:
 * none=לא הועלה; uploaded=הועלה, טרם חולץ; extracted=חולץ וממתין לאישור (לא עובדות
 * מאושרות!); applied=אושר והוחל (העובדות עודכנו).
 */
export type PayslipStatus = "none" | "uploaded" | "extracted" | "applied";

export interface CaseState {
  case: CaseRecord;
  facts: CaseFacts;
  scenarios: Scenario[];
  latestComparison: ComparisonRecord | null;
  openInquiries: InquiryRecord[];
  /** סטטוס זרימת התלוש של המסמך העדכני (לסנכרון הקשר; ראו PayslipStatus). */
  payslipStatus: PayslipStatus;
}