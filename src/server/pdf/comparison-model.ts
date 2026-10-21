// src/server/pdf/comparison-model.ts
// ממפה מצב תיק -> מודל תצוגה שטוח ל-PDF ההשוואה. מודול טהור (ללא דיסק/רשת/מסד):
// מקבל CaseState + מפת שמות רכב ומחזיר מחרוזות מוכנות להצגה.
//
// עיקרון (design §9.1): סכומים מגיעים מפלט המנוע בלבד. אין כאן חישוב מס/נטו/הפרש.
// היחידים שנגזרים הם שלושה צירופים שהכרטיס בממשק (ComparisonView) כבר מציג בגב האריח,
// באותה נוסחה בדיוק, כדי שה-PDF והמסך יתאימו זה לזה:
//   שווי שימוש = taxableIncome - cashSalary
//   מס + ביטוח לאומי = incomeTax + nationalInsurance + health
//   הפרשות = pensionEmployee + trainingEmployee
//
// השוואה חלקית (incomplete) אינה מפיקה מסמך: אין מציגים הפרש מומצא כשחסר נתון.

import type { CaseState, Scenario } from "../../domain/contracts/case.js";
import type { NetBreakdown, RouteKind, ScenarioResult } from "../../domain/contracts/types.js";
import { isComparisonStale } from "../../domain/calculation/staleness.js";
import { BREAKDOWN_LABELS } from "../../domain/calculation/breakdown-labels.js";

/** עיצוב שקלים זהה ל-ComparisonView: מספר שלם, he-IL, עם ₪. */
export function formatShekel(value: string | number): string {
  const n = typeof value === "string" ? Number(value) : value;
  return `${new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 }).format(n)} ₪`;
}

const ROUTE_LABELS: Record<RouteKind, string> = {
  company_car: "רכב חברה (מסלול רגיל)",
  family: "מסלול משפחתי",
  // שם הכרטיס כבר אומר "ויתור על רכב"; תווית המסלול משלימה ולא חוזרת עליו.
  waiver: "מסלול ויתור (ללא רכב חברה)",
};

export interface PdfRow {
  label: string;
  value: string;
  /** ערך אפס/ריק - מוצג מעומעם. */
  muted?: boolean;
}

export interface PdfStateCard {
  /** "היום" / "אחרי ההחלפה". */
  title: string;
  /** שם הרכב או "ויתור על רכב". */
  subtitle: string;
  routeLabel: string;
  net: string;
  rows: PdfRow[];
}

export interface PdfBreakdownRow {
  label: string;
  today: string;
  alternative: string;
  /** שני הערכים אפס - מוצג מעומעם. */
  muted: boolean;
}

export interface ComparisonPdfModel {
  generatedAtLabel: string;
  isDemo: boolean;
  /** true => הנטו עלה / לא ירד. */
  gain: boolean;
  deltaLabel: string;
  deltaAmount: string;
  today: PdfStateCard;
  alternative: PdfStateCard;
  breakdown: PdfBreakdownRow[];
  assumptions: string[];
  /** אזהרת תוצאה מיושנת (הנתונים השתנו מאז החישוב), או null. */
  staleWarning: string | null;
  meta: {
    comparisonRef: string;
    calculatedAtLabel: string;
    factsRevision: number;
    rulesRef: string;
  };
}

export type ComparisonModelResult =
  | { ok: true; model: ComparisonPdfModel }
  | { ok: false; reason: "no_comparison" | "incomplete" | "missing_scenario"; message: string };

const num = (s: string): number => Number(s);
const isZero = (s: string): boolean => Math.abs(num(s)) < 0.5;

function essentialRows(r: ScenarioResult, scenario: Scenario): PdfRow[] {
  const b = r.breakdown;
  const valueOfUse = num(b.taxableIncome) - num(b.cashSalary);
  const taxAndInsurance = num(b.incomeTax) + num(b.nationalInsurance) + num(b.health);
  const contributions = num(b.pensionEmployee) + num(b.trainingEmployee);
  const rows: PdfRow[] = [
    { label: "שווי שימוש", value: formatShekel(valueOfUse), muted: Math.abs(valueOfUse) < 0.5 },
    { label: "מס + ביטוח לאומי", value: formatShekel(taxAndInsurance), muted: Math.abs(taxAndInsurance) < 0.5 },
    { label: "הפרשות", value: formatShekel(contributions), muted: Math.abs(contributions) < 0.5 },
  ];
  if (scenario.maintenanceAllowance > 0) {
    rows.push({ label: "אחזקת רכב", value: formatShekel(scenario.maintenanceAllowance) });
  }
  return rows;
}

function stateCard(
  title: string, scenario: Scenario, result: ScenarioResult, vehicleNames: Record<string, string>, fallbackName: string,
): PdfStateCard {
  const subtitle = scenario.route === "waiver"
    ? "ויתור על רכב"
    : scenario.vehicleCode
      ? (vehicleNames[scenario.vehicleCode] ?? scenario.vehicleCode)
      : fallbackName;
  return {
    title,
    subtitle,
    routeLabel: ROUTE_LABELS[scenario.route],
    net: formatShekel(result.netDisplay),
    rows: essentialRows(result, scenario),
  };
}

/** תאריך עברי קצר (dd.mm.yyyy) באזור זמן ישראל. */
export function formatDateHe(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Jerusalem",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")}`;
}

export function buildComparisonPdfModel(
  state: CaseState,
  vehicleNames: Record<string, string>,
  now: Date = new Date(),
): ComparisonModelResult {
  const cmp = state.latestComparison;
  if (!cmp) {
    return { ok: false, reason: "no_comparison", message: "עדיין אין השוואה לייצוא." };
  }
  const baseline = state.scenarios.find((s) => s.id === cmp.baselineScenarioId)
    ?? state.scenarios.find((s) => s.role === "baseline");
  const alternative = state.scenarios.find((s) => s.id === cmp.alternativeScenarioId)
    ?? state.scenarios.find((s) => s.role === "alternative");
  if (!baseline || !alternative) {
    return { ok: false, reason: "missing_scenario", message: "נתוני ההשוואה אינם שלמים." };
  }
  const { baseline: b, alternative: a } = cmp.result;
  if (b.incomplete || a.incomplete) {
    return {
      ok: false,
      reason: "incomplete",
      message: "ההשוואה חלקית (חסרים נתונים), ולכן אין סיכום להורדה. אפשר להשלים את הנתונים בשיחה.",
    };
  }

  const delta = cmp.result.netDeltaDisplay;
  const gain = delta >= 0;
  const stale = isComparisonStale(state);

  const assumptions = [...(b.assumptions ?? []), ...(a.assumptions ?? [])]
    .filter((v, i, arr) => arr.indexOf(v) === i);

  const breakdown: PdfBreakdownRow[] = (Object.keys(BREAKDOWN_LABELS) as Array<keyof NetBreakdown>).map((k) => {
    const tv = b.breakdown[k] ?? "0";
    const av = a.breakdown[k] ?? "0";
    return {
      label: BREAKDOWN_LABELS[k],
      today: isZero(tv) ? "—" : formatShekel(tv),
      alternative: isZero(av) ? "—" : formatShekel(av),
      muted: isZero(tv) && isZero(av),
    };
  });

  return {
    ok: true,
    model: {
      generatedAtLabel: formatDateHe(now),
      isDemo: state.case.isDemo,
      gain,
      deltaLabel: gain ? "יותר בנטו בכל חודש" : "פחות בנטו בכל חודש",
      deltaAmount: formatShekel(Math.abs(delta)),
      today: stateCard("היום", baseline, b, vehicleNames, "המצב הנוכחי"),
      alternative: stateCard("אחרי ההחלפה", alternative, a, vehicleNames, "החלופה"),
      breakdown,
      assumptions,
      staleWarning: stale ? "הנתונים השתנו מאז החישוב — כדאי לחשב מחדש לפני הסתמכות על המספרים." : null,
      meta: {
        comparisonRef: cmp.id.slice(0, 8),
        calculatedAtLabel: formatDateHe(cmp.completedAt),
        factsRevision: cmp.factsRevision,
        rulesRef: cmp.ruleSetHash.slice(0, 8),
      },
    },
  };
}
