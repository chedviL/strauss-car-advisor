// src/domain/calculation/engine.ts
// מנוע חישוב נטו טהור. דטרמיניסטי: אין Date.now, אקראיות, רשת או מודל.
// מקור הכללים: קובץ ה-JSON (RuleSet). סדר החישוב לפי design §5.2.

import Decimal from "decimal.js";
import type {
  CompleteInput,
  NetBreakdown,
  RuleSet,
  ScenarioResult,
  TaxBracket,
  TwoRateBand,
} from "../contracts/types.js";

Decimal.set({ precision: 40 });

const D = (n: Decimal.Value): Decimal => new Decimal(n);

/** מס שולי לפי מדרגות: כל שקל ממוסה בשיעור המדרגה שאליה הוא שייך. */
function marginalTax(base: Decimal, brackets: TaxBracket[]): Decimal {
  if (base.lte(0)) return D(0);
  let tax = D(0);
  let last = D(0);
  for (const b of brackets) {
    const cap = b.upTo === null ? null : D(b.upTo);
    const upper = cap === null ? base : Decimal.min(base, cap);
    const seg = upper.minus(last);
    if (seg.gt(0)) tax = tax.plus(seg.times(b.rate));
    if (cap === null || base.lte(cap)) break;
    last = cap;
  }
  return tax;
}

/** ביטוח לאומי/בריאות בשתי מדרגות: שיעור נמוך עד הסף, גבוה בין הסף לתקרה, אפס מעל. */
function twoRate(base: Decimal, band: TwoRateBand): Decimal {
  if (base.lte(0)) return D(0);
  const low = Decimal.min(base, band.threshold).times(band.lowRate);
  const highPortion = Decimal.max(
    0,
    Decimal.min(base, band.ceiling).minus(band.threshold),
  );
  const high = highPortion.times(band.highRate);
  return low.plus(high);
}

interface CoreResult {
  netExact: Decimal;
  breakdown: {
    cashSalary: Decimal;
    taxableIncome: Decimal;
    insuranceBase: Decimal;
    incomeTax: Decimal;
    nationalInsurance: Decimal;
    health: Decimal;
    pensionEmployee: Decimal;
    trainingEmployee: Decimal;
    participation: Decimal;
    familyGap: Decimal;
    electricGrossUp: Decimal;
    pensionCredit: Decimal;
    creditPointsCredit: Decimal;
  };
}

/**
 * ליבת החישוב ללא גילום. electricGrossUp מוזרק מבחוץ (0 כברירת מחדל),
 * כדי שהפותר המספרי של הגילום יוכל להעריך את ההפרש בנטו.
 */
function computeCore(
  input: CompleteInput,
  rules: RuleSet,
  electricGrossUp: Decimal,
): CoreResult {
  const nm = rules.netMethod;
  const base = D(input.baseSalary);
  const commission = D(input.commission);
  const bonus = D(input.bonus);
  const maintenance = D(input.maintenanceAllowance);
  const valueOfUse = D(input.valueOfUse);
  const participation = D(input.participation);

  // (1) שכר מזומן: בסיס + עמלות + בונוס + אחזקה + גילום חשמל
  const gross = base.plus(commission).plus(bonus);
  const cashSalary = gross.plus(maintenance).plus(electricGrossUp);

  // (2) בסיסי הפרשות עובד לפי contributionsBase (O2: gross = בסיס+עמלות+בונוס)
  const contribBase = nm.contributionsBase === "gross" ? gross : base;
  const pensionEmployee = contribBase.times(input.pensionRate);
  const trainingEmployee = contribBase.times(input.trainingRate);

  // (3) שווי שימוש נכנס לבסיס המס ולבסיס הביטוח (אינו מזומן)
  const taxableIncome = cashSalary.plus(valueOfUse);
  const insuranceBase = cashSalary.plus(valueOfUse);

  // (4) מס שולי פחות זיכויים
  const grossTax = marginalTax(taxableIncome, nm.brackets);
  const creditPointsCredit = D(nm.creditPointValue).times(input.creditPoints);
  // זיכוי פנסיה (O3): rate על ההפקדה המזכה, עד maxContributionRate × incomeCeiling
  const pc = nm.pensionCredit;
  const creditableContribution = Decimal.min(
    pensionEmployee,
    D(pc.maxContributionRate).times(pc.incomeCeiling),
  );
  const pensionCredit = creditableContribution.times(pc.rate);
  let incomeTax = grossTax.minus(creditPointsCredit).minus(pensionCredit);
  if (incomeTax.lt(0)) incomeTax = D(0); // זיכוי שאינו בר-החזר

  // (5) ביטוח לאומי ובריאות
  const nationalInsurance = twoRate(insuranceBase, nm.nationalInsurance);
  const health = twoRate(insuranceBase, nm.health);

  // (6) פער משפחתי: max(0, עלות רכב - תקציב קבוצה) × חלק העובד
  let familyGap = D(0);
  if (input.route === "family") {
    const budget = D(rules.budgets[input.group] ?? 0);
    const gap = Decimal.max(0, D(input.companyCarCost).minus(budget));
    familyGap = gap.times(rules.familyTrack.gapSplitEmployee);
  }

  // (7) נטו: מזומן פחות מס, ביטוח, הפרשות, השתתפות ופער משפחתי
  const netExact = cashSalary
    .minus(incomeTax)
    .minus(nationalInsurance)
    .minus(health)
    .minus(pensionEmployee)
    .minus(trainingEmployee)
    .minus(participation)
    .minus(familyGap);

  return {
    netExact,
    breakdown: {
      cashSalary,
      taxableIncome,
      insuranceBase,
      incomeTax,
      nationalInsurance,
      health,
      pensionEmployee,
      trainingEmployee,
      participation,
      familyGap,
      electricGrossUp,
      pensionCredit,
      creditPointsCredit,
    },
  };
}

/**
 * פתרון הגילום: מציאת תוספת ברוטו x כך שהפרש הנטו הנובע ממנה = netBonus (250),
 * באמצעות bisection חסום. מכבד מעברי מדרגה, ספים ותקרות. אין נוסחת 250/(1-rate).
 */
function solveElectricGrossUp(input: CompleteInput, rules: RuleSet): Decimal {
  const target = D(rules.electric.netBonus);
  const netWithout = computeCore(input, rules, D(0)).netExact;

  // חסם עליון: גילום לא יכול לעלות על target / (1 - שיעור שולי מרבי קרוב ל-1).
  // נתחיל מחסם רחב ונצמצם ב-bisection.
  let lo = D(0);
  let hi = target.times(10); // חסם בטוח: גם בשיעור 90% זה מספיק
  const tolerance = D("0.00000001");
  const maxIter = 200;

  for (let i = 0; i < maxIter; i++) {
    const mid = lo.plus(hi).div(2);
    const netWith = computeCore(input, rules, mid).netExact;
    const delta = netWith.minus(netWithout);
    const diff = delta.minus(target);
    if (diff.abs().lt(tolerance)) return mid;
    // delta עולה מונוטונית עם mid (תוספת ברוטו מגדילה נטו), לכן:
    if (delta.lt(target)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo.plus(hi).div(2);
}

function roundDisplay(value: Decimal, rules: RuleSet): Decimal {
  if (rules.netMethod.rounding.display === "shekel") {
    return value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  }
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function toBreakdown(b: CoreResult["breakdown"]): NetBreakdown {
  const s = (d: Decimal): string => d.toFixed(2);
  return {
    cashSalary: s(b.cashSalary),
    taxableIncome: s(b.taxableIncome),
    insuranceBase: s(b.insuranceBase),
    incomeTax: s(b.incomeTax),
    nationalInsurance: s(b.nationalInsurance),
    health: s(b.health),
    pensionEmployee: s(b.pensionEmployee),
    trainingEmployee: s(b.trainingEmployee),
    participation: s(b.participation),
    familyGap: s(b.familyGap),
    electricGrossUp: s(b.electricGrossUp),
    pensionCredit: s(b.pensionCredit),
    creditPointsCredit: s(b.creditPointsCredit),
  };
}

/**
 * calculateScenario - הפונקציה הטהורה הראשית.
 * אותו קלט מלא + אותה גרסת כללים → אותו פלט עד האגורה.
 */
export function calculateScenario(
  input: CompleteInput,
  rules: RuleSet,
): ScenarioResult {
  const assumptions: string[] = [];

  const electricGrossUp = input.isElectric
    ? solveElectricGrossUp(input, rules)
    : D(0);
  if (input.isElectric) {
    assumptions.push(
      `גילום החזר חשמל חושב כך שהפרש הנטו = ${rules.electric.netBonus} ₪`,
    );
  }

  const core = computeCore(input, rules, electricGrossUp);
  const netDisplay = roundDisplay(core.netExact, rules);

  return {
    netExact: core.netExact.toFixed(2),
    netDisplay: netDisplay.toFixed(0),
    breakdown: toBreakdown(core.breakdown),
    incomplete: false,
    missingFields: [],
    assumptions,
  };
}

/** עזר לבדיקות: הפרש הנטו שתוספת הגילום מייצרת (לפני עיגול תצוגה). */
export function electricNetDelta(
  input: CompleteInput,
  rules: RuleSet,
): { grossUp: string; netDelta: string } {
  const grossUp = input.isElectric ? solveElectricGrossUp(input, rules) : D(0);
  const withGrossUp = computeCore(input, rules, grossUp).netExact;
  const withoutInput: CompleteInput = { ...input, isElectric: false };
  const without = computeCore(withoutInput, rules, D(0)).netExact;
  return {
    grossUp: grossUp.toFixed(2),
    netDelta: withGrossUp.minus(without).toFixed(2),
  };
}
