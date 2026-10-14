// src/domain/contracts/types.ts
// חוזי נתונים לליבת החישוב. טיפוסים טהורים ללא תלות ברשת/מסד/מודל.

/** מחרוזת עשרונית קנונית, למשל "14200.00". לעולם לא מספר מעוצב כגון "14,200 ₪". */
export type DecimalString = string;

export type GroupCode = "א" | "ב" | "ג" | "ד" | "משפחתי";

/** 0=בנזין 1=היברידי 2=פלאג-אין 3=חשמלי (לפי driveField ב-JSON, לא לפי כותרת ה-CSV). */
export type Propulsion = 0 | 1 | 2 | 3;

/** מסלול התרחיש. */
export type RouteKind = "company_car" | "family" | "waiver";

/** בסיס ההפרשות (O2): gross = בסיס+עמלות+בונוס. */
export type ContributionsBase = "gross" | "base_only";

/** מדיניות עיגול (O7). */
export interface RoundingPolicy {
  during: "none" | "agora";
  display: "shekel" | "agora";
}

export interface TaxBracket {
  /** גבול עליון של המדרגה; null = מדרגה אחרונה (ללא תקרה). */
  upTo: number | null;
  rate: number;
}

export interface TwoRateBand {
  threshold: number;
  ceiling: number;
  lowRate: number;
  highRate: number;
}

export interface PensionCreditRule {
  rate: number;
  maxContributionRate: number;
  incomeCeiling: number;
}

export interface FamilyTrackRule {
  minChildren: number;
  childMaxAge: number;
  cars: string[];
  priceSource: "catalogue";
  gapSplitEmployee: number;
}

export interface ElectricRule {
  netBonus: number;
  method: "gross_up" | "gross_fixed";
}

export interface ParticipationRule {
  treatment: "net_deduction";
  reducesValueOfUse: boolean;
}

/** גרסת כללים מלאה, נטענת מה-JSON ומזוהה לפי contentHash (לא לפי version). */
export interface RuleSet {
  version: string;
  contentHash: string;
  budgets: Record<string, number>;
  groupOrder: string[];
  chooseFrom: "own_group_or_lower";
  electric: ElectricRule;
  familyTrack: FamilyTrackRule;
  waiver: {
    allowedBy: "occupation";
    maintenanceIsTaxable: boolean;
    maintenanceIsPensionable: boolean;
  };
  unusedBudget: "not_paid";
  netMethod: {
    basis: "monthly";
    taxYear: number;
    creditPointValue: number;
    brackets: TaxBracket[];
    nationalInsurance: TwoRateBand;
    health: TwoRateBand;
    pensionCredit: PensionCreditRule;
    contributionsBase: ContributionsBase;
    participation: ParticipationRule;
    rounding: RoundingPolicy;
  };
  valueOfUse: {
    source: string;
    key: string[];
    driveField: Record<string, string>;
  };
}

/** קלט מלא לחישוב תרחיש יחיד. אין undefined כאפס - ערך חסר נבדק מראש. */
export interface CompleteInput {
  route: RouteKind;
  group: string;
  /** שכר בסיס חודשי. */
  baseSalary: number;
  commission: number;
  bonus: number;
  /** אחוז הפרשת עובד לפנסיה, למשל 0.06. */
  pensionRate: number;
  /** אחוז הפרשת עובד לקרן השתלמות, למשל 0.025. */
  trainingRate: number;
  creditPoints: number;
  /** שווי שימוש חודשי של הרכב בתרחיש (0 בוויתור). */
  valueOfUse: number;
  /** האם הרכב בתרחיש חשמלי (מזכה בגילום החזר חשמל). */
  isElectric: boolean;
  /** השתתפות עובד אישית ברכב (ניכוי נטו). */
  participation: number;
  /** עלות הרכב החודשית לחברה (למסלול משפחתי - לחישוב הפער). */
  companyCarCost: number;
  /** דמי אחזקה בוויתור (חייב במס, לא פנסיוני). 0 אם לא ויתור. */
  maintenanceAllowance: number;
}

export interface NetBreakdown {
  cashSalary: DecimalString;
  taxableIncome: DecimalString;
  insuranceBase: DecimalString;
  incomeTax: DecimalString;
  nationalInsurance: DecimalString;
  health: DecimalString;
  pensionEmployee: DecimalString;
  trainingEmployee: DecimalString;
  participation: DecimalString;
  familyGap: DecimalString;
  electricGrossUp: DecimalString;
  pensionCredit: DecimalString;
  creditPointsCredit: DecimalString;
}

export interface ScenarioResult {
  /** נטו מדויק (ללא עיגול) כמחרוזת עשרונית. */
  netExact: DecimalString;
  /** נטו לתצוגה (מעוגל לפי מדיניות העיגול). */
  netDisplay: DecimalString;
  breakdown: NetBreakdown;
  incomplete: boolean;
  missingFields: string[];
  assumptions: string[];
}
