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
  FactsPatch,
  UpdateFactsOutcome,
  ComputeTxnOutcome,
} from "../repositories/case-repository.js";
import type { ResolvedVehicle } from "../repositories/catalog-import.js";
import { validateEligibility, type Occupation } from "../../domain/eligibility/engine.js";
import type { RouteKind } from "../../domain/contracts/types.js";
import { getActiveDataset, getActiveDatasetFromDb, findActiveDatasetId, type ActiveDataset } from "./dataset-provider.js";
import {
  SAMPLE_EMPLOYEES,
  type SampleEmployee,
} from "../../../data/source/sample-employees.js";

export interface ResolveResult {
  status: "ok" | "missing_data";
  input?: CompleteInput;
  missingFields?: string[];
  /** הנחות מתועדות (למשל השתתפות שנלקחה מברירת מחדל של הכללים). */
  assumptions?: string[];
}

/** מרכיב CompleteInput מעובדות התיק, התרחיש וה-dataset. אין undefined כאפס. */
export function resolveScenarioInput(
  facts: CaseFacts,
  scenario: Scenario,
  dataset: ActiveDataset,
): ResolveResult {
  const missing: string[] = [];
  const assumptions: string[] = [];
  const req = (v: number | null, name: string): number => {
    if (v === null || v === undefined) {
      missing.push(name);
      return 0;
    }
    return v;
  };

  // ירושה: שדה ללא override יורש את העובדה המשותפת; override מחליף ערך בתרחיש בלבד.
  const ov = scenario.overrides ?? {};
  const baseSalary = req(ov.baseSalary ?? facts.baseSalary, "baseSalary");
  const commission = req(ov.commission ?? facts.commission, "commission");
  const bonus = req(ov.bonus ?? facts.bonus, "bonus");
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

  // --- השתתפות: הבחנה בין ערך מאומת (כולל אפס מפורש), ברירת מחדל מותרת
  //     לפי הכללים/הקטלוג, לבין מידע חסר. אין להפוך חוסר לאפס בשקט. ---
  let participation = 0;
  if (scenario.route === "waiver") {
    // בוויתור אין השתתפות ברכב; אפס מובנה, ללא הנחה.
    participation = 0;
  } else if (scenario.participation !== null && scenario.participation !== undefined) {
    // ערך מאומת שנמסר (כולל 0 מפורש).
    participation = scenario.participation;
  } else {
    // אין ערך שנמסר: אם לקטלוג יש ברירת מחדל מותרת - משתמשים ומתעדים הנחה.
    const v = scenario.vehicleCode ? dataset.vehiclesByCode.get(scenario.vehicleCode) : undefined;
    if (v && v.defaultParticipation !== null && v.defaultParticipation !== undefined) {
      participation = v.defaultParticipation;
      assumptions.push(
        `השתתפות ברכב לא נמסרה; נלקחה ברירת המחדל של הדגם (${v.defaultParticipation} ₪).`,
      );
    } else {
      // אין ערך ואין ברירת מחדל מותרת - חסר נדרש.
      missing.push("participation");
    }
  }

  if (missing.length > 0) {
    return { status: "missing_data", missingFields: missing, assumptions };
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
    participation,
    companyCarCost,
    maintenanceAllowance: scenario.maintenanceAllowance,
  };
  return { status: "ok", input, assumptions };
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
  const result = calculateScenario(resolved.input, dataset.rules);
  // משלבים הנחות מהפתרון (למשל ברירת מחדל של השתתפות) עם הנחות המנוע.
  const assumptions = [...(resolved.assumptions ?? []), ...result.assumptions];
  return { status: "ok", result: { ...result, assumptions } };
}

export class CaseService {
  constructor(private readonly repo: CaseRepository) {}

  /** dataset פעיל: מגובה-מסד (ללא פענוח CSV) כש-DATABASE_URL מוגדר, אחרת מקבצים. */
  private async getDataset(): Promise<ActiveDataset> {
    const appConn = process.env.DATABASE_URL;
    if (appConn && appConn.trim() !== "") {
      return await getActiveDatasetFromDb(appConn);
    }
    return getActiveDataset();
  }

  /**
   * חימום: טוען מראש את ה-dataset (ל-cache) ופותח חיבור DB, כדי שהתור הראשון
   * לא ישלם את ה-TLS handshake (~1.2s) ואת טעינת ה-dataset. fire-and-forget.
   */
  async warmup(): Promise<void> {
    try {
      await this.getDataset();
    } catch {
      /* חימום בלבד - כשל כאן אינו מפיל בקשה אמיתית */
    }
  }

  listSampleEmployees(): SampleEmployee[] {
    return SAMPLE_EMPLOYEES;
  }

  /**
   * פותח תיק ריק לשיחה אמיתית (ללא עובד לדוגמה). עובדות ריקות + baseline
   * זמני (רכב לא ידוע). השיחה תמלא עובדות ואת המצב הנוכחי. אין נטו עד שיש קלט.
   */
  async startBlankCase(ownerId: string): Promise<CaseState> {
    const dataset = await this.getDataset();
    const facts: CaseFacts = {
      occupationCode: null, reportedGroup: null, baseSalary: null, commission: null,
      bonus: null, pensionRate: null, trainingRate: null, creditPoints: null, qualifyingChildren: null,
    };
    const baseline: CreateScenarioInput = {
      role: "baseline", route: "company_car", vehicleCode: null,
      participation: null, maintenanceAllowance: 0,
    };
    const datasetId = await this.resolveDatasetId(dataset);
    return await this.repo.createCase({ ownerId, isDemo: true, datasetId, facts, baseline });
  }

  /** יוצר תיק דגמה מעובד לדוגמה: עובדות + baseline (המצב הנוכחי). */
  async createDemoCaseFromEmployee(
    ownerId: string,
    employeeId: string,
    datasetIdOverride?: string,
  ): Promise<CaseState> {
    const emp = SAMPLE_EMPLOYEES.find((e) => e.id === employeeId);
    if (!emp) throw new Error("עובד לדוגמה לא נמצא");
    const dataset = await this.getDataset();
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
    const datasetId = datasetIdOverride ?? (await this.resolveDatasetId(dataset));
    return await this.repo.createCase({
      ownerId,
      isDemo: true,
      datasetId,
      facts,
      baseline,
    });
  }

  /**
   * זרימת דמו מלאה בקריאה אחת: יצירת תיק+baseline, יישום החלופה המוצעת,
   * טעינת מצב פעם אחת, וחישוב+שמירת השוואה - ללא טעינות מצב כפולות.
   * מצמצם מהותית round-trips מול pooler מרוחק (היה מקור ה-latency).
   */
  async startDemoFlow(
    ownerId: string,
    employeeId: string,
  ): Promise<CaseState> {
    const emp = SAMPLE_EMPLOYEES.find((e) => e.id === employeeId);
    if (!emp) throw new Error("עובד לדוגמה לא נמצא");
    const created = await this.createDemoCaseFromEmployee(ownerId, employeeId);
    const caseId = created.case.id;
    await this.pickAlternative(caseId, ownerId, {
      role: "alternative",
      route: emp.suggestedAlternative.route,
      vehicleCode: emp.suggestedAlternative.vehicleCode,
      participation: emp.suggestedAlternative.participation,
      maintenanceAllowance: emp.suggestedAlternative.maintenanceAllowance,
    });
    // טוענים מצב פעם אחת ומעבירים לחישוב (preloaded) כדי לא לקרוא שוב מהמסד.
    const state = await this.repo.getCaseState(caseId, ownerId);
    if (!state) throw new Error("תיק לא נמצא לבעלים");
    await this.computeAndSaveComparison(caseId, ownerId, state);
    // מצב סופי כולל ההשוואה שנשמרה.
    const finalState = await this.repo.getCaseState(caseId, ownerId);
    return finalState ?? state;
  }

  /**
   * מחזיר את מזהה ה-dataset לשימוש ביצירת תיק:
   * - אם קיים חיבור בעלים/מסד (MIGRATION_DATABASE_URL/DATABASE_URL) -> UUID אמיתי מהמסד (idempotent).
   * - אחרת (אחסון קבצים מקומי) -> contentId (hash) שמספיק לקבצים.
   */
  private async resolveDatasetId(dataset: ActiveDataset): Promise<string> {
    if (dataset.datasetId) return dataset.datasetId;
    const appConn = process.env.DATABASE_URL;
    if (appConn && appConn.trim() !== "") {
      const id = await findActiveDatasetId(appConn);
      if (!id) {
        throw new Error(
          "ה-dataset הפעיל טרם יובא למסד. הרץ: npm run import:dataset (ראו docs/supabase-setup.md).",
        );
      }
      return id;
    }
    // אחסון קבצים מקומי בלבד (ללא DATABASE_URL): contentId מספיק.
    return dataset.contentId;
  }

  async getCaseState(caseId: string, ownerId: string): Promise<CaseState | null> {
    return await this.repo.getCaseState(caseId, ownerId);
  }

  /** רשימת הבירורים של המשתמש/ת המאומת/ת בלבד (בעלות נאכפת ב-repository/RLS). */
  async listCaseSummaries(ownerId: string, limit?: number) {
    return await this.repo.listCaseSummaries(ownerId, limit);
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

  /** עדכון רכב ה-baseline (המצב הנוכחי של העובד/ת). */
  async updateBaselineVehicle(
    caseId: string,
    ownerId: string,
    input: { route: RouteKind; vehicleCode: string | null; participation: number | null; maintenanceAllowance: number },
  ): Promise<Scenario> {
    return await this.repo.updateBaselineVehicle(caseId, ownerId, input);
  }

  /** מחשב baseline מול alternative, שומר השוואה immutable, ומחזיר אותה. */
  async computeAndSaveComparison(
    caseId: string,
    ownerId: string,
    preloadedState?: CaseState,
  ): Promise<{ status: "ok"; comparison: ComparisonRecord } | { status: "missing_data"; missingFields: string[] } | { status: "no_alternative" }> {
    // ה-dataset נקרא מראש (cache בזיכרון, ללא DB בהרצה חמה). ה-compute עצמו
    // טהור וסינכרוני - בטוח להריץ בתוך הטרנזקציה (אין I/O ואין קריאת מודל).
    const dataset = await this.getDataset();

    // חישוב טהור ממצב נתון -> רשומת השוואה או מצב חוסר. אין DB כאן.
    const computeFrom = (state: CaseState): ComputeTxnOutcome => {
      const baseline = state.scenarios.find((s) => s.role === "baseline");
      const alternative = state.scenarios.find((s) => s.role === "alternative");
      if (!baseline) throw new Error("אין baseline לתיק");
      if (!alternative) return { status: "no_alternative" };
      const b = computeScenario(state.facts, baseline, dataset);
      const a = computeScenario(state.facts, alternative, dataset);
      if (b.status !== "ok") return { status: "missing_data", missingFields: b.missingFields };
      if (a.status !== "ok") return { status: "missing_data", missingFields: a.missingFields };
      const netDeltaDisplay = Number(a.result.netDisplay) - Number(b.result.netDisplay);
      return {
        status: "ok",
        record: {
          caseId,
          baselineScenarioId: baseline.id,
          alternativeScenarioId: alternative.id,
          ruleSetHash: dataset.rules.contentHash,
          factsRevision: state.case.factsRevision,
          inputSnapshot: { baseline, alternative },
          result: { baseline: b.result, alternative: a.result, netDeltaDisplay },
        },
      };
    };

    // אם המצב כבר נטען (למשל מ-startDemoFlow) - משתמשים בו ושומרים בטרנזקציה אחת.
    // אחרת - טעינה+חישוב+שמירה בטרנזקציה אחת (מצמצם round-trips).
    if (preloadedState) {
      const outcome = computeFrom(preloadedState);
      if (outcome.status !== "ok") return outcome;
      const comparison = await this.repo.saveComparison(caseId, ownerId, outcome.record);
      return { status: "ok", comparison };
    }
    return await this.repo.computeComparisonTxn(caseId, ownerId, computeFrom);
  }

  /** פתיחת פנייה לנציג. השרת בונה את ה-contextFingerprint; dedup לפניות פתוחות. */
  async openInquiry(
    caseId: string,
    ownerId: string,
    type: import("../../domain/contracts/case.js").InquiryType,
    scenarioId: string | null,
    contextParts: Record<string, string | number | null>,
  ) {
    const fp = Object.entries(contextParts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v ?? ""}`)
      .join("|");
    return await this.repo.openInquiry(caseId, ownerId, {
      type, scenarioId, contextFingerprint: fp,
    });
  }

  /** רישום תשובת נציג על פנייה (ערך מובנה + תחולה). לשימוש מסך הנציג/הדמיה. */
  async answerInquiry(
    inquiryId: string,
    ownerId: string,
    answer: { value: number | null; note: string | null; effectiveFrom: string | null },
  ) {
    return await this.repo.answerInquiry(inquiryId, ownerId, answer);
  }

  /** רשימת הפניות לנציג (כל התיקים של הבעלים) עם ההקשר המינימלי להכרעה. */
  async listInquiriesForRep(ownerId: string) {
    return await this.repo.listInquiriesByOwner(ownerId);
  }

  /**
   * מענה נציג + החלת התשובה על התיק + חישוב מחדש של ההשוואה - צד-שרת בלבד,
   * כך שזה עובד גם כשהעובדת מנותקת. בחזרתה היא תראה את התשובה ואת התוצאה המעודכנת.
   *
   * רלוונטיות/גרסה: בודקים שגרסת העובדות ששימשה בעת פתיחת הפנייה (מתוך
   * contextFingerprint) עדיין תואמת לגרסה הנוכחית. אם לא - מסמנים staleContext,
   * עדיין רושמים את התשובה, אך לא מחילים אוטומטית ערך על תרחיש שהקשרו השתנה.
   *
   * החלה: רק employee_participation מתורגם לערך מספרי על ההשתתפות של התרחיש המקושר.
   * הבהרת זכאות אינה ערך-החלה - נרשמת כתשובה בלבד.
   */
  async answerAndApplyInquiry(
    inquiryId: string,
    ownerId: string,
    answer: { value: number | null; note: string | null; effectiveFrom: string | null },
    options?: { today?: string },
  ): Promise<{
    status: "applied" | "recorded_not_applied" | "stale_context" | "future_effective" | "not_found";
    inquiry?: import("../../domain/contracts/case.js").InquiryRecord;
    caseId?: string;
    recomputed?: boolean;
    missingFields?: string[];
    reason?: string;
    effectiveFrom?: string;
  }> {
    // 1) מאתרים את הפנייה בהקשרה (על פני תיקי הבעלים). אכיפת בעלות: בעלים אחר
    //    לא יראה את הפנייה כאן (RLS/בידוד ברמת ה-repository) -> not_found.
    const all = await this.repo.listInquiriesByOwner(ownerId);
    const ctx = all.find((x) => x.inquiry.id === inquiryId);
    if (!ctx) return { status: "not_found" };

    // 2) בדיקת רלוונטיות לפי גרסת העובדות שבטביעת ההקשר.
    const fpRev = parseFactsRevisionFromFingerprint(ctx.inquiry.contextFingerprint);
    const stale = fpRev !== null && fpRev !== ctx.currentFactsRevision;

    // 3) רושמים את התשובה תמיד (תיעוד מה שהנציג מסר). פעולה אידמפוטנטית:
    //    רישום חוזר של אותה תשובה אינו משנה דבר פרט ל-answered_at.
    const inquiry = await this.repo.answerInquiry(inquiryId, ownerId, answer);

    // 4) הבהרת זכאות - תיעוד בלבד, אין ערך-החלה.
    if (ctx.inquiry.type !== "employee_participation") {
      return { status: "recorded_not_applied", inquiry, caseId: ctx.caseId, reason: "not_participation" };
    }
    // אין ערך מספרי להחיל (הנציג מסר הערה בלבד).
    if (answer.value === null) {
      return { status: "recorded_not_applied", inquiry, caseId: ctx.caseId, reason: "no_value" };
    }
    // התרחיש אינו ידוע/נמחק - אין היכן להחיל.
    if (!ctx.inquiry.scenarioId || ctx.scenarioRole === null) {
      return { status: "recorded_not_applied", inquiry, caseId: ctx.caseId, reason: "no_scenario" };
    }
    // ההקשר השתנה (העובדות עודכנו מאז הפנייה) - לא מחילים אוטומטית. התשובה
    // נשמרה; הדרך להמשיך: לפתוח פנייה מחדש בהקשר העדכני או לאשר ידנית.
    if (stale) {
      return { status: "stale_context", inquiry, caseId: ctx.caseId, reason: "facts_changed" };
    }
    // תחולה עתידית: תשובה שתכנס לתוקף בעתיד נשמרת אך אינה מוחלת כעת כאילו
    // כבר בתוקף. ההחלה תתבצע כשתגיע התחולה (או באישור ידני מפורש).
    const future = isFutureDate(answer.effectiveFrom, options?.today);
    if (future) {
      return { status: "future_effective", inquiry, caseId: ctx.caseId, reason: "future_effective", effectiveFrom: answer.effectiveFrom! };
    }

    // 5) מחילים את ההשתתפות על התרחיש המקושר (שמירה על שאר שדות התרחיש).
    //    התאוששות מכשל חלקי + מניעת החלה כפולה: ההחלה היא set-to-value
    //    (אידמפוטנטית). אם הערך כבר זהה - מדלגים על הכתיבה (לא מגדילים revision),
    //    כך שניסיון חוזר אחרי כשל חלקי אינו "מחיל פעמיים" ואינו מרעיש גרסאות.
    const state = await this.repo.getCaseState(ctx.caseId, ownerId);
    if (!state) return { status: "not_found" };
    const scen = state.scenarios.find((s) => s.id === ctx.inquiry.scenarioId);
    if (!scen) return { status: "recorded_not_applied", inquiry, caseId: ctx.caseId, reason: "no_scenario" };

    if (scen.participation !== answer.value) {
      if (scen.role === "baseline") {
        await this.repo.updateBaselineVehicle(ctx.caseId, ownerId, {
          route: scen.route, vehicleCode: scen.vehicleCode,
          participation: answer.value, maintenanceAllowance: scen.maintenanceAllowance,
        });
      } else {
        await this.repo.upsertAlternative(ctx.caseId, ownerId, {
          role: "alternative", route: scen.route, vehicleCode: scen.vehicleCode,
          participation: answer.value, maintenanceAllowance: scen.maintenanceAllowance,
          overrides: scen.overrides,
        });
      }
    }

    // 6) חישוב מחדש + שמירת ההשוואה (צד-שרת; עובד גם כשהעובדת מנותקת).
    //    חישוב מחדש תמיד בטוח: הוא יוצר רשומת השוואה חדשה ממצב עדכני, ולכן
    //    ניסיון חוזר אחרי כשל חלקי (אחרי החלה, לפני שמירה) משלים את השמירה.
    const recompute = await this.computeAndSaveComparison(ctx.caseId, ownerId);
    if (recompute.status === "missing_data") {
      return { status: "applied", inquiry, caseId: ctx.caseId, recomputed: false, missingFields: recompute.missingFields };
    }
    if (recompute.status === "no_alternative") {
      return { status: "applied", inquiry, caseId: ctx.caseId, recomputed: false, reason: "no_alternative" };
    }
    return { status: "applied", inquiry, caseId: ctx.caseId, recomputed: true };
  }

  /** שמירת הודעות שיחה לשחזור אחרי רענון. */
  async appendMessages(
    caseId: string,
    ownerId: string,
    messages: Array<{ role: string; clientMessageId: string | null; content: unknown }>,
  ) {
    return await this.repo.appendMessages(caseId, ownerId, messages);
  }

  /** טעינת הודעות השיחה של התיק. */
  async loadMessages(caseId: string, ownerId: string) {
    return await this.repo.loadMessages(caseId, ownerId);
  }

  /** מפת קוד-רכב -> שם מסחרי מהקטלוג, לתצוגה (CAR-10 -> ATTO 3). */
  async vehicleNames(): Promise<Record<string, string>> {
    const dataset = await this.getDataset();
    const out: Record<string, string> = {};
    for (const v of dataset.vehiclesByCode.values()) {
      if (v.commercialName) out[v.id] = v.commercialName;
    }
    return out;
  }

  /** קביעה/ניקוי של הבקשה הפעילה הממתינה לנתונים. */
  async setPendingRequest(caseId: string, ownerId: string, req: import("../../domain/contracts/case.js").PendingRequest | null) {
    return await this.repo.setPendingRequest(caseId, ownerId, req);
  }

  /** שליפת תוצאת השוואה שמורה לפי מזהה (לפירוט לפי דרישה, בלי חישוב מחדש). */
  async loadCompareRun(caseId: string, ownerId: string, runId: string) {
    return await this.repo.loadCompareRun(caseId, ownerId, runId);
  }

  /** עדכון עובדות משותפות עם בדיקת גרסה. לתיקון עובדה אמיתית (לא סימולציה). */
  async updateFacts(
    caseId: string,
    ownerId: string,
    patch: FactsPatch,
    expectedRevision: number,
  ): Promise<UpdateFactsOutcome> {
    return await this.repo.updateFacts(caseId, ownerId, patch, expectedRevision);
  }

  /**
   * החלת חילוץ תלוש: מסמן applied ומעדכן עובדות *בטרנזקציה אחת* (אטומי).
   * כשל/קונפליקט אינו משאיר חילוץ מסומן "הוחל" בלי עדכון עובדות.
   */
  async applyPayslip(
    caseId: string,
    ownerId: string,
    uploadId: string,
    patch: FactsPatch,
    expectedRevision: number,
  ) {
    return await this.repo.applyPayslipAndUpdateFacts(caseId, ownerId, uploadId, patch, expectedRevision);
  }

  /**
   * חיפוש רכבים עם סטטוס זכאות וסיבות. מסנן רק לפי שדות שקיימים במקור מאומת.
   * אין המצאת מושבים/טווח; פילטר לא-נתמך מוחזר כ-unsupportedFilters.
   */
  async searchVehicles(
    occupation: Occupation,
    filters?: VehicleSearchFilters,
  ): Promise<VehicleSearchResult> {
    const dataset = await this.getDataset();
    const supported = new Set(["propulsion", "group", "route"]);
    const unsupportedFilters = filters
      ? Object.keys(filters).filter((k) => !supported.has(k))
      : [];
    const all = [...dataset.vehiclesByCode.values()];
    const candidates = all
      .filter((v) => {
        if (filters?.propulsion !== undefined && v.propulsion !== filters.propulsion) return false;
        if (filters?.group !== undefined && v.group !== filters.group) return false;
        return true;
      })
      .map((v) => {
        const targetGroup = v.group === "משפחתי" ? undefined : v.group;
        const route: RouteKind = v.group === "משפחתי" ? "family" : "company_car";
        const elig = validateEligibility(
          { occupation, route, targetGroup, qualifyingChildren: undefined },
          dataset.rules,
        );
        return {
          vehicleCode: v.id,
          name: v.commercialName,
          group: v.group,
          propulsion: v.propulsion,
          valueOfUse: v.valueOfUse,
          companyCost: String(v.companyCost),
          eligibility: elig.status,
          reasons: elig.reasons,
        };
      });
    return { candidates, unsupportedFilters };
  }

  /**
   * זיהוי רכב לפי שם מסחרי (חלקי, case-insensitive) מול קטלוג מאומת.
   * מחזיר רשומה אחת מזוהה, רשימת מועמדים על עמימות, או "לא נמצא".
   * זכאות מחושבת לפי occupation שנמסר.
   */
  async lookupVehicleByName(
    nameQuery: string,
    occupation?: Occupation,
  ): Promise<
    | { status: "found"; vehicle: { id: string; commercialName: string; group: string; propulsion: number; valueOfUse: string }; eligibility: string; reasons: string[] }
    | { status: "ambiguous"; matches: Array<{ id: string; commercialName: string; group: string }> }
    | { status: "not_found" }
  > {
    const dataset = await this.getDataset();
    const norm = (s: string) => s.replace(/[-\s]+/g, "").toLowerCase();
    // כינויים עבריים -> תת-מחרוזת בשם המסחרי הלטיני שבקטלוג. מבוסס-נתונים, לא ניחוש:
    // ממפה כתיב עברי נפוץ לשם הקיים בקטלוג. אם אין התאמה - עדיין not_found.
    const HE_ALIASES: Array<{ he: RegExp; latin: string }> = [
      { he: /קורולה\s*קרוס|קורולהקרוס/, latin: "corollacross" },
      { he: /קורולה/, latin: "corolla" },
      { he: /אטו|אטו\s*3|אאטו/, latin: "atto" },
      { he: /דולפין/, latin: "dolphin" },
      { he: /סיל\b/, latin: "seal" },
      { he: /טוסון/, latin: "tucson" },
      { he: /קונה/, latin: "kona" },
      { he: /נירו/, latin: "niro" },
      { he: /פיקנטו/, latin: "picanto" },
      { he: /יאריס/, latin: "yaris" },
      { he: /לאון/, latin: "leon" },
      { he: /מאזדה/, latin: "mazda" },
      { he: /אוקטביה/, latin: "octavia" },
      { he: /ספורטאז|ספורטג/, latin: "sportage" },
      { he: /קרניבל/, latin: "carnival" },
      { he: /סנטה\s*פה|סנטהפה/, latin: "santafe" },
      { he: /ראב\s*4|ראב4|raf4/, latin: "rav4" },
      { he: /מודל\s*3|טסלה/, latin: "model3" },
    ];
    // אם הקלט מכיל עברית, מנסים להמיר לכינוי לטיני תואם קטלוג.
    let qRaw = nameQuery;
    for (const a of HE_ALIASES) {
      if (a.he.test(nameQuery)) { qRaw = a.latin; break; }
    }
    const q = norm(qRaw);
    if (!q) return { status: "not_found" };
    const all = [...dataset.vehiclesByCode.values()];
    const matches = all.filter((v) => norm(v.commercialName).includes(q));
    if (matches.length === 0) return { status: "not_found" };
    if (matches.length > 1) {
      return { status: "ambiguous", matches: matches.map((v) => ({ id: v.id, commercialName: v.commercialName, group: v.group })) };
    }
    const v = matches[0]!;
    const elig = occupation
      ? validateEligibility(
          { occupation, route: "company_car", targetGroup: v.group, qualifyingChildren: undefined },
          dataset.rules,
        )
      : { status: "unknown" as const, reasons: [] };
    return {
      status: "found",
      vehicle: { id: v.id, commercialName: v.commercialName, group: v.group, propulsion: v.propulsion, valueOfUse: v.valueOfUse },
      eligibility: elig.status,
      reasons: elig.reasons,
    };
  }

  /**
   * השוואה גמישה בקוד, באצווה אחת:
   * - explicit: רשימת חלופות (רכבים/ויתור) מול baseline.
   * - discover: סורק את הקטלוג (ואופציה ויתור), ממיין לפי הפרש נטו, מסנן לפי minNetDelta.
   * baseline מחושב פעם אחת. אין קריאת מודל פר-רכב. אין נטו כשחסר קלט.
   */
  async compareScenarios(
    caseId: string,
    ownerId: string,
    request: CompareRequest,
  ): Promise<CompareResult> {
    const state = await this.repo.getCaseState(caseId, ownerId);
    if (!state) throw new Error("תיק לא נמצא לבעלים");
    const dataset = await this.getDataset();
    const baselineScenario = state.scenarios.find((s) => s.role === "baseline");
    if (!baselineScenario) throw new Error("אין baseline לתיק");

    const baseCalc = computeScenario(state.facts, baselineScenario, dataset);
    if (baseCalc.status !== "ok") {
      return { status: "missing_data", missingFields: baseCalc.missingFields, baseline: null, comparisons: [], excluded: [], incomplete: [] };
    }
    const baselineNet = Number(baseCalc.result.netDisplay);

    // בניית רשימת חלופות מועמדות.
    let candidateInputs: CandidateSpec[];
    if (request.mode === "explicit") {
      candidateInputs = request.candidates;
    } else {
      candidateInputs = [...dataset.vehiclesByCode.values()]
        .filter((v) => v.group !== "משפחתי")
        .map<CandidateSpec>((v) => ({
          label: v.id,
          route: "company_car",
          vehicleCode: v.id,
          participation: v.defaultParticipation,
          maintenanceAllowance: 0,
        }));
      if (request.includeWaiver) {
        candidateInputs.push({
          label: "ויתור",
          route: "waiver",
          vehicleCode: null,
          participation: 0,
          maintenanceAllowance: request.waiverMaintenance ?? 0,
        });
      }
    }

    const occupation = request.occupation;
    const comparisons: CompareRow[] = [];
    const excluded: ExcludedRow[] = [];
    const incomplete: IncompleteRow[] = [];

    for (const cand of candidateInputs) {
      const scenario = {
        id: "cand:" + cand.label, caseId, role: "alternative" as const,
        route: cand.route, vehicleCode: cand.vehicleCode,
        participation: cand.participation, maintenanceAllowance: cand.maintenanceAllowance,
        overrides: cand.overrides ?? {},
        revision: 0,
      };
      // זכאות בקוד.
      if (occupation) {
        const targetGroup = cand.route === "company_car" && cand.vehicleCode
          ? dataset.vehiclesByCode.get(cand.vehicleCode)?.group
          : undefined;
        const elig = validateEligibility(
          { occupation, route: cand.route, targetGroup, qualifyingChildren: state.facts.qualifyingChildren ?? undefined },
          dataset.rules,
        );
        if (elig.status === "ineligible") {
          excluded.push({ label: cand.label, reasons: elig.reasons });
          continue;
        }
      }
      const calc = computeScenario(state.facts, scenario, dataset);
      if (calc.status !== "ok") {
        incomplete.push({ label: cand.label, missingFields: calc.missingFields });
        continue;
      }
      const net = Number(calc.result.netDisplay);
      comparisons.push({
        label: cand.label,
        name: cand.vehicleCode ? (dataset.vehiclesByCode.get(cand.vehicleCode)?.commercialName ?? cand.label) : cand.label,
        route: cand.route,
        vehicleCode: cand.vehicleCode,
        participation: cand.participation,
        maintenanceAllowance: cand.maintenanceAllowance,
        net,
        netDelta: net - baselineNet,
        result: calc.result,
      });
    }

    // דירוג לפי הפרש נטו יורד; סינון לפי minNetDelta אם נדרש.
    comparisons.sort((a, b) => b.netDelta - a.netDelta);
    const filtered =
      request.minNetDelta !== undefined
        ? comparisons.filter((c) => c.netDelta >= request.minNetDelta!)
        : comparisons;

    const result: CompareResult = {
      status: "ok",
      baseline: { net: baselineNet, result: baseCalc.result },
      comparisons: filtered,
      excluded,
      incomplete,
      coverage: {
        requested: candidateInputs.length,
        computed: comparisons.length,
        excluded: excluded.length,
        incomplete: incomplete.length,
      },
    };
    // שומרים את התוצאה המלאה לשליפה בהמשך לפי מזהה (פירוט/כולן/שישי).
    const compareRunId = await this.repo.saveCompareRun(caseId, ownerId, {
      factsRevision: state.case.factsRevision,
      ruleSetHash: dataset.rules.contentHash,
      mode: request.mode,
      ranking: "net_delta_desc",
      result,
    });

    // כדי שהכרטיס בממשק יציג את החלופה המובילה: קובעים אותה כ-alternative
    // ושומרים comparison (baseline מול המובילה) מהתוצאות שכבר חושבו (ללא חישוב מחדש).
    const top = filtered[0];
    if (top) {
      const altScenario = await this.repo.upsertAlternative(caseId, ownerId, {
        role: "alternative",
        route: top.route,
        vehicleCode: top.vehicleCode,
        // שומרים את ההשתתפות/אחזקה בפועל שבהן חושבה החלופה המובילה, כדי שהתרחיש
        // השמור יתאים למה שהוצג (ולא יתאפס ל-null ויסתמך על ברירת מחדל בחישוב חוזר).
        participation: top.participation,
        maintenanceAllowance: top.maintenanceAllowance,
        overrides: {},
      });
      const baselineScenario = state.scenarios.find((s) => s.role === "baseline")!;
      await this.repo.saveComparison(caseId, ownerId, {
        caseId,
        baselineScenarioId: baselineScenario.id,
        alternativeScenarioId: altScenario.id,
        ruleSetHash: dataset.rules.contentHash,
        factsRevision: state.case.factsRevision,
        inputSnapshot: { baseline: baselineScenario, alternative: altScenario },
        result: {
          baseline: baseCalc.result,
          alternative: top.result,
          netDeltaDisplay: top.netDelta,
        },
      });
    }

    return { ...result, compareRunId, factsRevision: state.case.factsRevision, ruleSetHash: dataset.rules.contentHash };
  }
}

/**
 * שולף את גרסת העובדות מתוך contextFingerprint שנבנה ב-openInquiry
 * (זוגות key=value ממוינים ומופרדים ב-"|"). מחזיר null אם לא נמצא/לא מספרי.
 */
function parseFactsRevisionFromFingerprint(fp: string): number | null {
  for (const part of fp.split("|")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq) === "factsRevision") {
      const v = part.slice(eq + 1);
      if (v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

/**
 * האם תאריך התחולה הוא עתידי ביחס ל"היום" (ברירת מחדל: היום בפועל, UTC).
 * השוואה ברמת יום (YYYY-MM-DD). תחולה == היום אינה עתידית (נכנסת לתוקף היום).
 * ערך ריק/לא תקין -> לא עתידי (אין תחולה מגבילה).
 */
function isFutureDate(effectiveFrom: string | null, today?: string): boolean {
  if (!effectiveFrom) return false;
  const eff = effectiveFrom.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eff)) return false;
  const now = (today ?? new Date().toISOString()).slice(0, 10);
  return eff > now;
}

// --- types for search/compare ---
export interface VehicleSearchFilters {
  propulsion?: 0 | 1 | 2 | 3;
  group?: string;
  route?: RouteKind;
  [key: string]: unknown;
}
export interface VehicleSearchResult {
  candidates: Array<{
    vehicleCode: string;
    name: string;
    group: string;
    propulsion: number;
    valueOfUse: string;
    companyCost: string;
    eligibility: string;
    reasons: string[];
  }>;
  unsupportedFilters: string[];
}

export interface CandidateSpec {
  label: string;
  route: RouteKind;
  vehicleCode: string | null;
  participation: number | null;
  maintenanceAllowance: number;
  overrides?: import("../../domain/contracts/case.js").ScenarioOverrides;
}

export type CompareRequest =
  | {
      mode: "explicit";
      candidates: CandidateSpec[];
      occupation?: Occupation;
      minNetDelta?: number;
    }
  | {
      mode: "discover";
      includeWaiver?: boolean;
      waiverMaintenance?: number;
      occupation?: Occupation;
      minNetDelta?: number;
    };

export interface CompareRow {
  label: string;
  name: string;
  route: RouteKind;
  vehicleCode: string | null;
  participation: number | null;
  maintenanceAllowance: number;
  net: number;
  netDelta: number;
  result: ScenarioResult;
}
export interface ExcludedRow { label: string; reasons: string[]; }
export interface IncompleteRow { label: string; missingFields: string[]; }

export type CompareResult =
  | {
      status: "ok";
      baseline: { net: number; result: ScenarioResult };
      comparisons: CompareRow[];
      excluded: ExcludedRow[];
      incomplete: IncompleteRow[];
      coverage: { requested: number; computed: number; excluded: number; incomplete: number };
      compareRunId?: string;
      factsRevision?: number;
      ruleSetHash?: string;
    }
  | {
      status: "missing_data";
      missingFields: string[];
      baseline: null;
      comparisons: never[];
      excluded: never[];
      incomplete: never[];
    };