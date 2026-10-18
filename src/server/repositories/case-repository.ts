// src/server/repositories/case-repository.ts
// ממשק repository למצב התיק (אסינכרוני) + מימוש מבוסס קובץ (לדמו ולבדיקות).
// אוכף בעלות (isolation) ואילוץ baseline יחיד - מקביל ל-RLS ולאילוצי המסד.
// מימוש Supabase-Postgres (PgCaseRepository) מממש את אותו ממשק מול Postgres עם RLS.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  CaseFacts,
  InquiryRecord,
  InquiryType,
  ScenarioOverrides,
  CaseRecord,
  CaseState,
  ComparisonRecord,
  Scenario,
  ScenarioRole,
} from "../../domain/contracts/case.js";
import type { RouteKind } from "../../domain/contracts/types.js";

export interface CreateScenarioInput {
  role: ScenarioRole;
  route: RouteKind;
  vehicleCode: string | null;
  participation: number | null;
  maintenanceAllowance: number;
  overrides?: ScenarioOverrides;
}

/** עדכון עובדות חלקי: רק שדות שנכללים משתנים. clear מפורש != אפס. */
export type FactsPatch = Partial<{
  occupationCode: string | null;
  reportedGroup: string | null;
  baseSalary: number | null;
  commission: number | null;
  bonus: number | null;
  pensionRate: number | null;
  trainingRate: number | null;
  creditPoints: number | null;
  qualifyingChildren: number | null;
}>;

export type ComputeTxnOutcome =
  | { status: "ok"; record: Omit<ComparisonRecord, "id" | "completedAt"> }
  | { status: "missing_data"; missingFields: string[] }
  | { status: "no_alternative" };

export type ComparisonTxnResult =
  | { status: "ok"; comparison: ComparisonRecord }
  | { status: "missing_data"; missingFields: string[] }
  | { status: "no_alternative" };

export type UpdateFactsOutcome =
  | { status: "ok"; factsRevision: number }
  | { status: "conflict"; currentRevision: number };

/**
 * תוצאת החלת חילוץ תלוש + עדכון עובדות בטרנזקציה אחת:
 * - applied: סומן כהוחל *וגם* העובדות עודכנו (או שלא נדרש שינוי). אטומי.
 * - already_applied: ההעלאה כבר הוחלה בעבר (applied_at לא null) - לא נגענו בעובדות.
 * - conflict: גרסת העובדות השתנתה; הטרנזקציה גולגלה אחורה - הסימון "הוחל" *לא* נשמר.
 */
export type ApplyPayslipOutcome =
  | { status: "applied"; factsRevision: number }
  | { status: "already_applied" }
  | { status: "conflict"; currentRevision: number };

export interface StoredCompareRun {
  id: string;
  factsRevision: number;
  ruleSetHash: string;
  mode: string;
  ranking: string;
  result: unknown;
  createdAt: string;
}

export interface StoredMessage {
  id: string;
  role: string;
  seq: number;
  clientMessageId: string | null;
  content: unknown;
  createdAt: string;
}

/**
 * תצוגת פנייה לנציג עם ההקשר המינימלי הנדרש להכרעה בלבד:
 * סוג, מסלול/רכב/קבוצה, גרסת העובדות הנוכחית וערך ההשתתפות הנוכחי בתרחיש.
 * ללא שכר, נטו או פרטים אישיים - הנציג מכריע לפי ההקשר הדרוש בלבד.
 */
export interface RepInquiryContext {
  inquiry: InquiryRecord;
  caseId: string;
  caseUpdatedAt: string;
  currentFactsRevision: number;
  scenarioRole: ScenarioRole | null;
  route: RouteKind | null;
  vehicleCode: string | null;
  reportedGroup: string | null;
  currentParticipation: number | null;
}

export interface CaseRepository {
  createCase(input: {
    ownerId: string;
    isDemo: boolean;
    datasetId: string;
    facts: CaseFacts;
    baseline: CreateScenarioInput;
  }): Promise<CaseState>;
  /** טוען מצב תיק רק אם הוא בבעלות ownerId; אחרת null (בלי לחשוף קיום). */
  getCaseState(caseId: string, ownerId: string): Promise<CaseState | null>;
  listCasesByOwner(ownerId: string): Promise<CaseRecord[]>;
  upsertAlternative(
    caseId: string,
    ownerId: string,
    input: CreateScenarioInput,
  ): Promise<Scenario>;
  /** מעדכן את רכב ה-baseline (המצב הנוכחי) - route/vehicle/participation/maintenance. */
  updateBaselineVehicle(
    caseId: string,
    ownerId: string,
    input: { route: import("../../domain/contracts/types.js").RouteKind; vehicleCode: string | null; participation: number | null; maintenanceAllowance: number },
  ): Promise<Scenario>;
  saveComparison(
    caseId: string,
    ownerId: string,
    record: Omit<ComparisonRecord, "id" | "completedAt">,
  ): Promise<ComparisonRecord>;
  /**
   * טוען מצב, מריץ compute סינכרוני (ללא I/O/מודל), ושומר השוואה - הכל
   * בטרנזקציה אחת. מצמצם round-trips (BEGIN/COMMIT/set_config פעם אחת,
   * בלי select כפול). ה-callback חייב להיות טהור וסינכרוני.
   */
  computeComparisonTxn(
    caseId: string,
    ownerId: string,
    compute: (state: CaseState) => ComputeTxnOutcome,
  ): Promise<ComparisonTxnResult>;
  /** עדכון עובדות עם בדיקת גרסה (optimistic). מעלה facts_revision אם היה שינוי סמנטי. */
  updateFacts(
    caseId: string,
    ownerId: string,
    patch: FactsPatch,
    expectedRevision: number,
  ): Promise<UpdateFactsOutcome>;
  /**
   * אטומי: מסמן את התלוש כ"הוחל" (רק אם טרם הוחל) *וגם* מעדכן עובדות עם בדיקת
   * גרסה - בטרנזקציה אחת. כשל/קונפליקט בעדכון מגלגל אחורה גם את הסימון, כך
   * שלא נשאר חילוץ מסומן "הוחל" בלי שהעובדות עודכנו.
   */
  applyPayslipAndUpdateFacts(
    caseId: string,
    ownerId: string,
    uploadId: string,
    patch: FactsPatch,
    expectedRevision: number,
  ): Promise<ApplyPayslipOutcome>;
  /** פותח פנייה לנציג עם dedup לפי (type, contextFingerprint) בפניות פתוחות. */
  openInquiry(
    caseId: string,
    ownerId: string,
    input: { type: InquiryType; scenarioId: string | null; contextFingerprint: string },
  ): Promise<{ inquiry: InquiryRecord; deduped: boolean }>;
  /** רישום תשובת נציג על פנייה (ערך מובנה + תחולה). מעביר ל-answered. */
  answerInquiry(
    inquiryId: string,
    ownerId: string,
    answer: { value: number | null; note: string | null; effectiveFrom: string | null },
  ): Promise<InquiryRecord>;
  /**
   * מחזיר את כל הפניות של הבעלים (על פני כל התיקים) עם ההקשר המינימלי להכרעה.
   * משמש את מסך הנציג. אוכף בעלות - לא חושף פניות של בעלים אחר.
   */
  listInquiriesByOwner(ownerId: string): Promise<RepInquiryContext[]>;
  /** שומר הודעות שיחה (append) לשחזור אחרי רענון. seq רציף לכל תיק. */
  appendMessages(
    caseId: string,
    ownerId: string,
    messages: Array<{ role: string; clientMessageId: string | null; content: unknown }>,
  ): Promise<void>;
  /** טוען את הודעות השיחה של התיק לפי סדר. */
  loadMessages(caseId: string, ownerId: string): Promise<StoredMessage[]>;
  /** קובע/מנקה את הבקשה הפעילה הממתינה לנתונים (עמיד, שורד רענון). */
  setPendingRequest(caseId: string, ownerId: string, req: import("../../domain/contracts/case.js").PendingRequest | null): Promise<void>;
  /** שומר תוצאת השוואה גמישה מלאה; מחזיר מזהה לשליפה בהמשך. */
  saveCompareRun(
    caseId: string,
    ownerId: string,
    run: { factsRevision: number; ruleSetHash: string; mode: string; ranking: string; result: unknown },
  ): Promise<string>;
  /** שולף תוצאת השוואה שמורה לפי מזהה (אם בבעלות). */
  loadCompareRun(caseId: string, ownerId: string, runId: string): Promise<StoredCompareRun | null>;
}

interface StoredCase {
  case: CaseRecord;
  facts: CaseFacts;
  scenarios: Scenario[];
  comparisons: ComparisonRecord[];
  inquiries?: InquiryRecord[];
  messages?: StoredMessage[];
  compareRuns?: StoredCompareRun[];
}

/** מימוש מבוסס קובץ: קובץ JSON לכל תיק תחת rootDir/<ownerId>/<caseId>.json. */
export class FileCaseRepository implements CaseRepository {
  constructor(private readonly rootDir: string) {
    mkdirSync(rootDir, { recursive: true });
  }

  private ownerDir(ownerId: string): string {
    const safe = ownerId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.rootDir, safe);
  }
  private casePath(ownerId: string, caseId: string): string {
    return join(this.ownerDir(ownerId), `${caseId}.json`);
  }
  private read(ownerId: string, caseId: string): StoredCase | null {
    const p = this.casePath(ownerId, caseId);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as StoredCase;
  }
  private write(stored: StoredCase): void {
    const dir = this.ownerDir(stored.case.ownerId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      this.casePath(stored.case.ownerId, stored.case.id),
      JSON.stringify(stored, null, 2),
      "utf8",
    );
  }
  private toState(stored: StoredCase): CaseState {
    const latest =
      stored.comparisons.length > 0
        ? stored.comparisons[stored.comparisons.length - 1]!
        : null;
    return {
      case: stored.case,
      facts: stored.facts,
      scenarios: stored.scenarios,
      latestComparison: latest,
      openInquiries: (stored.inquiries ?? []).filter((q) => q.status === "open" || q.status === "answered"),
    };
  }

  async createCase(input: {
    ownerId: string;
    isDemo: boolean;
    datasetId: string;
    facts: CaseFacts;
    baseline: CreateScenarioInput;
  }): Promise<CaseState> {
    const now = new Date().toISOString();
    const caseId = randomUUID();
    if (input.baseline.role !== "baseline") {
      throw new Error("baseline scenario must have role=baseline");
    }
    const baseline: Scenario = {
      id: randomUUID(),
      caseId,
      role: "baseline",
      route: input.baseline.route,
      vehicleCode: input.baseline.vehicleCode,
      participation: input.baseline.participation,
      maintenanceAllowance: input.baseline.maintenanceAllowance,
      overrides: input.baseline.overrides ?? {},
      revision: 0,
    };
    const stored: StoredCase = {
      case: {
        id: caseId, ownerId: input.ownerId, isDemo: input.isDemo,
        datasetId: input.datasetId, status: "active", factsRevision: 0,
        pendingRequest: null,
        createdAt: now, updatedAt: now,
      },
      facts: input.facts,
      scenarios: [baseline],
      comparisons: [],
      inquiries: [],
    };
    this.write(stored);
    return this.toState(stored);
  }

  async getCaseState(caseId: string, ownerId: string): Promise<CaseState | null> {
    const stored = this.read(ownerId, caseId);
    if (!stored || stored.case.ownerId !== ownerId) return null;
    return this.toState(stored);
  }

  async listCasesByOwner(ownerId: string): Promise<CaseRecord[]> {
    const dir = this.ownerDir(ownerId);
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    const cases = files.map(
      (f) => (JSON.parse(readFileSync(join(dir, f), "utf8")) as StoredCase).case,
    );
    return cases.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async upsertAlternative(
    caseId: string,
    ownerId: string,
    input: CreateScenarioInput,
  ): Promise<Scenario> {
    const stored = this.read(ownerId, caseId);
    if (!stored || stored.case.ownerId !== ownerId) {
      throw new Error("case not found for owner");
    }
    if (input.role !== "alternative") {
      throw new Error("upsertAlternative requires role=alternative");
    }
    const existing = stored.scenarios.find((s) => s.role === "alternative");
    const scenario: Scenario = {
      id: existing ? existing.id : randomUUID(),
      caseId, role: "alternative", route: input.route,
      vehicleCode: input.vehicleCode, participation: input.participation,
      maintenanceAllowance: input.maintenanceAllowance,
      overrides: input.overrides ?? {},
      revision: existing ? existing.revision + 1 : 0,
    };
    stored.scenarios = stored.scenarios
      .filter((s) => s.role !== "alternative")
      .concat(scenario);
    stored.case.updatedAt = new Date().toISOString();
    this.write(stored);
    return scenario;
  }

  async updateBaselineVehicle(
    caseId: string,
    ownerId: string,
    input: { route: import("../../domain/contracts/types.js").RouteKind; vehicleCode: string | null; participation: number | null; maintenanceAllowance: number },
  ): Promise<Scenario> {
    const stored = this.read(ownerId, caseId);
    if (!stored || stored.case.ownerId !== ownerId) throw new Error("case not found for owner");
    const existing = stored.scenarios.find((s) => s.role === "baseline");
    if (!existing) throw new Error("no baseline to update");
    const updated: Scenario = {
      ...existing, route: input.route, vehicleCode: input.vehicleCode,
      participation: input.participation, maintenanceAllowance: input.maintenanceAllowance,
      revision: existing.revision + 1,
    };
    stored.scenarios = stored.scenarios.filter((s) => s.role !== "baseline").concat(updated);
    stored.case.updatedAt = new Date().toISOString();
    this.write(stored);
    return updated;
  }

  async saveComparison(
    caseId: string,
    ownerId: string,
    record: Omit<ComparisonRecord, "id" | "completedAt">,
  ): Promise<ComparisonRecord> {
    const stored = this.read(ownerId, caseId);
    if (!stored || stored.case.ownerId !== ownerId) {
      throw new Error("case not found for owner");
    }
    const full: ComparisonRecord = {
      ...record, id: randomUUID(), completedAt: new Date().toISOString(),
    };
    stored.comparisons.push(full);
    stored.case.updatedAt = new Date().toISOString();
    this.write(stored);
    return full;
  }

  async computeComparisonTxn(
    caseId: string,
    ownerId: string,
    compute: (state: CaseState) => import("./case-repository.js").ComputeTxnOutcome,
  ): Promise<import("./case-repository.js").ComparisonTxnResult> {
    const stored = this.read(ownerId, caseId);
    if (!stored || stored.case.ownerId !== ownerId) {
      throw new Error("case not found for owner");
    }
    const outcome = compute(this.toState(stored));
    if (outcome.status !== "ok") return outcome;
    const full: ComparisonRecord = {
      ...outcome.record, id: randomUUID(), completedAt: new Date().toISOString(),
    };
    stored.comparisons.push(full);
    stored.case.updatedAt = new Date().toISOString();
    this.write(stored);
    return { status: "ok", comparison: full };
  }

  async updateFacts(
    caseId: string,
    ownerId: string,
    patch: FactsPatch,
    expectedRevision: number,
  ): Promise<UpdateFactsOutcome> {
    const stored = this.read(ownerId, caseId);
    if (!stored || stored.case.ownerId !== ownerId) {
      throw new Error("case not found for owner");
    }
    if (stored.case.factsRevision !== expectedRevision) {
      return { status: "conflict", currentRevision: stored.case.factsRevision };
    }
    let changed = false;
    const facts = stored.facts as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue; // שדה שלא נכלל ב-patch אינו משתנה
      if (facts[k] !== v) {
        facts[k] = v;
        changed = true;
      }
    }
    // תיקון חוזר לאותו ערך ללא שינוי סמנטי אינו יוצר גרסה חדשה.
    if (!changed) {
      return { status: "ok", factsRevision: stored.case.factsRevision };
    }
    stored.case.factsRevision += 1;
    stored.case.updatedAt = new Date().toISOString();
    this.write(stored);
    return { status: "ok", factsRevision: stored.case.factsRevision };
  }

  async applyPayslipAndUpdateFacts(
    caseId: string,
    ownerId: string,
    _uploadId: string,
    patch: FactsPatch,
    expectedRevision: number,
  ): Promise<ApplyPayslipOutcome> {
    // אחסון הקבצים אינו מנהל שורות payslip_uploads (אלה Postgres בלבד; זרימת
    // התלוש דורשת DATABASE_URL). כאן מיישמים את עדכון העובדות בלבד, אטומית
    // ברמת הקובץ (כתיבה אחת). במסלול הפרודקשן (Postgres) האטומיות מלאה.
    const res = await this.updateFacts(caseId, ownerId, patch, expectedRevision);
    if (res.status === "conflict") return { status: "conflict", currentRevision: res.currentRevision };
    return { status: "applied", factsRevision: res.factsRevision };
  }

  async openInquiry(
    caseId: string,
    ownerId: string,
    input: { type: InquiryType; scenarioId: string | null; contextFingerprint: string },
  ): Promise<{ inquiry: InquiryRecord; deduped: boolean }> {
    const stored = this.read(ownerId, caseId);
    if (!stored || stored.case.ownerId !== ownerId) {
      throw new Error("case not found for owner");
    }
    stored.inquiries = stored.inquiries ?? [];
    // dedup: פנייה פתוחה קיימת מאותו type ו-contextFingerprint מוחזרת כקיימת.
    const existing = stored.inquiries.find(
      (q) => q.status === "open" && q.type === input.type &&
        q.contextFingerprint === input.contextFingerprint,
    );
    if (existing) return { inquiry: existing, deduped: true };
    const inquiry: InquiryRecord = {
      id: randomUUID(), caseId, type: input.type,
      scenarioId: input.scenarioId, contextFingerprint: input.contextFingerprint,
      status: "open", createdAt: new Date().toISOString(),
      answerValue: null, answerNote: null, effectiveFrom: null, answeredAt: null,
    };
    stored.inquiries.push(inquiry);
    stored.case.updatedAt = new Date().toISOString();
    this.write(stored);
    return { inquiry, deduped: false };
  }

  async answerInquiry(
    inquiryId: string,
    ownerId: string,
    answer: { value: number | null; note: string | null; effectiveFrom: string | null },
  ): Promise<InquiryRecord> {
    // מאתר את התיק המכיל את הפנייה (בסביבת הקבצים אין אינדקס גלובלי).
    const dir = this.ownerDir(ownerId);
    if (!existsSync(dir)) throw new Error("inquiry not found for owner");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const stored = JSON.parse(readFileSync(join(dir, f), "utf8")) as StoredCase;
      const inq = (stored.inquiries ?? []).find((q) => q.id === inquiryId);
      if (inq) {
        inq.status = "answered";
        inq.answerValue = answer.value;
        inq.answerNote = answer.note;
        inq.effectiveFrom = answer.effectiveFrom;
        inq.answeredAt = new Date().toISOString();
        stored.case.updatedAt = new Date().toISOString();
        this.write(stored);
        return inq;
      }
    }
    throw new Error("inquiry not found for owner");
  }

  async listInquiriesByOwner(ownerId: string): Promise<RepInquiryContext[]> {
    const dir = this.ownerDir(ownerId);
    if (!existsSync(dir)) return [];
    const out: RepInquiryContext[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const stored = JSON.parse(readFileSync(join(dir, f), "utf8")) as StoredCase;
      if (stored.case.ownerId !== ownerId) continue;
      for (const inq of stored.inquiries ?? []) {
        if (inq.status === "cancelled") continue;
        const scen = inq.scenarioId
          ? stored.scenarios.find((s) => s.id === inq.scenarioId) ?? null
          : null;
        out.push({
          inquiry: inq,
          caseId: stored.case.id,
          caseUpdatedAt: stored.case.updatedAt,
          currentFactsRevision: stored.case.factsRevision,
          scenarioRole: scen?.role ?? null,
          route: scen?.route ?? null,
          vehicleCode: scen?.vehicleCode ?? null,
          reportedGroup: stored.facts.reportedGroup,
          currentParticipation: scen?.participation ?? null,
        });
      }
    }
    // פתוחות קודם, ואז לפי זמן יצירה יורד.
    out.sort((a, b) => {
      const sa = a.inquiry.status === "open" ? 0 : 1;
      const sb = b.inquiry.status === "open" ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return b.inquiry.createdAt.localeCompare(a.inquiry.createdAt);
    });
    return out;
  }

  async appendMessages(
    caseId: string,
    ownerId: string,
    messages: Array<{ role: string; clientMessageId: string | null; content: unknown }>,
  ): Promise<void> {
    const stored = this.read(ownerId, caseId);
    if (!stored || stored.case.ownerId !== ownerId) throw new Error("case not found for owner");
    stored.messages = stored.messages ?? [];
    let seq = stored.messages.length > 0 ? Math.max(...stored.messages.map((m) => m.seq)) + 1 : 0;
    for (const m of messages) {
      if (m.clientMessageId && stored.messages.some((x) => x.clientMessageId === m.clientMessageId)) continue;
      stored.messages.push({
        id: randomUUID(), role: m.role, seq, clientMessageId: m.clientMessageId,
        content: m.content, createdAt: new Date().toISOString(),
      });
      seq += 1;
    }
    this.write(stored);
  }

  async loadMessages(caseId: string, ownerId: string): Promise<StoredMessage[]> {
    const stored = this.read(ownerId, caseId);
    if (!stored || stored.case.ownerId !== ownerId) return [];
    return [...(stored.messages ?? [])].sort((a, b) => a.seq - b.seq);
  }

  async setPendingRequest(
    caseId: string,
    ownerId: string,
    req: import("../../domain/contracts/case.js").PendingRequest | null,
  ): Promise<void> {
    const stored = this.read(ownerId, caseId);
    if (!stored || stored.case.ownerId !== ownerId) throw new Error("case not found for owner");
    stored.case.pendingRequest = req;
    stored.case.updatedAt = new Date().toISOString();
    this.write(stored);
  }

  async saveCompareRun(
    caseId: string,
    ownerId: string,
    run: { factsRevision: number; ruleSetHash: string; mode: string; ranking: string; result: unknown },
  ): Promise<string> {
    const stored = this.read(ownerId, caseId);
    if (!stored || stored.case.ownerId !== ownerId) throw new Error("case not found for owner");
    stored.compareRuns = stored.compareRuns ?? [];
    const id = randomUUID();
    stored.compareRuns.push({ id, ...run, createdAt: new Date().toISOString() });
    this.write(stored);
    return id;
  }

  async loadCompareRun(caseId: string, ownerId: string, runId: string): Promise<StoredCompareRun | null> {
    const stored = this.read(ownerId, caseId);
    if (!stored || stored.case.ownerId !== ownerId) return null;
    return (stored.compareRuns ?? []).find((r) => r.id === runId) ?? null;
  }
}