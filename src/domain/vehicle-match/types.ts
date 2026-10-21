// src/domain/vehicle-match/types.ts
// חוזים טהורים לפיצ'ר "איזה רכב מתאים לי?". אין תלות ברשת/מסד/מודל/React.

// ───────────── תשובות השאלון ─────────────

/** שלב 1. "many" = יותר מחמישה מקומות (כולל הנהג) ואז נדרש seatsMin. */
export type PassengerAnswer = "one_two" | "three_five" | "many";
export type CargoAnswer = "bag" | "stroller" | "lots";
export type TripsAnswer = "city" | "mixed" | "long";
export type ChargingAnswer = "home_work" | "public" | "none" | "unsure";
export type PriorityAnswer = "net" | "cargo" | "compact" | "balanced";
export type SeatsMin = 6 | 7 | 8;

export interface QuestionnaireAnswers {
  passengers: PassengerAnswer | null;
  /** נדרש רק כש-passengers === "many". דרישה הכרחית, לא העדפה. */
  seatsMin: SeatsMin | null;
  cargo: CargoAnswer | null;
  trips: TripsAnswer | null;
  charging: ChargingAnswer | null;
  priority: PriorityAnswer | null;
}

export type CompleteAnswers = {
  [K in Exclude<keyof QuestionnaireAnswers, "seatsMin">]: NonNullable<QuestionnaireAnswers[K]>;
} & { seatsMin: SeatsMin | null };

export const EMPTY_ANSWERS: QuestionnaireAnswers = {
  passengers: null, seatsMin: null, cargo: null, trips: null, charging: null, priority: null,
};

// ───────────── מפרטים מאושרים ─────────────

export type SpecFieldKey =
  | "seats" | "lengthMm" | "widthMm" | "heightMm" | "wheelbaseMm"
  | "bootRearSeatsUpL" | "frunkL" | "batteryKwh" | "rangeWltpKm" | "acMaxKw" | "dcMaxKw";

/** filter/allowed = מותר לשימוש בסינון/דירוג. display_only/display_family_only = תצוגה בלבד, אסור לדירוג. */
export type SpecUse = "filter" | "allowed" | "display_only" | "display_family_only";

export interface SpecEvidence {
  sourceIds: string[];
  /** סיבת ההתאמה בעברית (ללא קודי מחקר). */
  basisHe: string;
  locator: string | null;
  noteHe: string;
}

export interface ApprovedField {
  value: number;
  unit: string;
  use: SpecUse;
  evidence: SpecEvidence;
}

export interface BlockedField {
  /** הסבר קצר למשתמש/ת. השדה נשאר null - אין ערך מומצא. */
  reasonHe: string;
  /** טווח מתועד שמותר להשוות כטווח בלבד (למשל אורך 4172–4180). */
  range?: [number, number];
}

/** שיטת מדידת נפח מטען. אי-תאימות ידועה (Tesla) = אסור להשוות אוטומטית. */
export type CargoMethod = "vda_beltline" | "unspecified" | "tesla_behind_second_row" | "unconfirmed";

export interface VehicleSpec {
  id: string;
  /** false = חסום להמלצה אוטומטית (CAR-20). */
  automaticRecommendationEnabled: boolean;
  registryTrim: string | null;
  registry: { bodyType: string; fuel: string; powertrain: string; drive: string } | null;
  fields: Partial<Record<SpecFieldKey, ApprovedField>>;
  blocked: Partial<Record<SpecFieldKey, BlockedField>>;
  cargo: { method: CargoMethod; seatsInUse: number | null };
  /** שיקולים קבועים מנתוני המקור, מנוסחים למשתמש/ת. */
  notesHe: string[];
}

export interface SpecSource {
  id: string;
  url: string;
  title: string;
  market: string;
  edition: string;
  kind: "registry" | "manufacturer" | "importer";
}

// ───────────── קלט/פלט המנוע ─────────────

export interface CatalogEntry {
  id: string;
  name: string;
  /** קבוצת זכאות בקטלוג: א/ב/ג/ד/משפחתי */
  group: string;
  /** 0=בנזין 1=היברידי 2=פלאג-אין 3=חשמלי */
  propulsion: 0 | 1 | 2 | 3;
}

export type NetOutcome =
  | {
      status: "ok";
      /** הפרש נטו חודשי מול הרכב הנוכחי (₪, מעוגל כמו בתצוגה הקיימת). */
      netDelta: number;
      net: number;
      assumptions: string[];
    }
  | { status: "unavailable"; missingFields: string[] };

export interface NetContext {
  baselineName: string | null;
  baselineNet: number | null;
  baselineAssumptions: string[];
  byVehicle: Record<string, NetOutcome>;
  /** חסר ברמת התיק (למשל שכר) - אין נטו לאף רכב. */
  caseMissingFields: string[];
}

export interface EligibilityInput {
  /** קבוצת הזכאות של העובד/ת, או null אם לא ידועה. לעולם לא מנוחשת. */
  group: string | null;
  qualifyingChildren: number | null;
}

export interface MatchEngineInput {
  answers: CompleteAnswers;
  eligibility: EligibilityInput;
  /** כללי זכאות ותקציב מהקוד הקיים (RuleSet) - מועברים לפונקציית הזכאות. */
  eligibilityCheck: (entry: CatalogEntry) => "eligible" | "ineligible" | "missing";
  catalog: CatalogEntry[];
  specs: VehicleSpec[];
  sources: Record<string, SpecSource>;
  /** null = אין תיק/נטו. */
  net: NetContext | null;
}

export type RankingBasis = "net" | "cargo" | "compact" | "balanced" | "balanced_fallback" | "none";

export interface Reason { code: string; text: string }

export interface DisplaySpec {
  key: SpecFieldKey | "powertrain";
  label: string;
  /** ערך מוצג (כולל יחידה). */
  valueText: string;
  note?: string;
  sourceIds: string[];
}

export interface MissingField { key: SpecFieldKey | "net" | "eligibility"; label: string; reason: string }

export type BadgeCode = "cargo_lead" | "net_lead" | "compact_lead";

export interface MatchOption {
  vehicleId: string;
  name: string;
  group: string;
  /** סוג הנעה כפי שבקטלוג העסקי (בנזין/היברידי/פלאג-אין/חשמלי). */
  propulsionLabel: string;
  /** סוג מרכב לפי מרשם הרכב, אם מאושר. */
  bodyType: string | null;
  reasons: Reason[];
  considerations: string[];
  missingFields: MissingField[];
  specs: DisplaySpec[];
  sources: SpecSource[];
  badges: Array<{ code: BadgeCode; text: string }>;
  net: { status: "ok"; netDelta: number; baselineName: string | null; assumptions: string[] } | { status: "unavailable" };
  /** סיבה לכך שהרכב אינו מדורג (רק ב-needsCheck). */
  checkReason?: string;
}

export interface MatchResult {
  status: "ok" | "needs_eligibility_group";
  rankingBasis: RankingBasis;
  /** תיאור קריטריוני הדירוג בפועל, בעברית. */
  rankingNote: string;
  /** עד שלושה, מדורגים לפי rankingBasis (אם rankingBasis !== "none"). */
  options: MatchOption[];
  /** אפשרויות שדורשות בדיקה - אינן מוצגות כמתאימות בוודאות. */
  needsCheck: MatchOption[];
  coverageNotes: string[];
  /** נימוק כשאין תוצאות. */
  emptyReason: string | null;
  netState: "available" | "needs_details" | "not_applicable";
  eligibleCount: number;
  groupUsed: string | null;
}
