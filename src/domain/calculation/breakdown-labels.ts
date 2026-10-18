// src/domain/calculation/breakdown-labels.ts
// מקור אמת יחיד לשמות רכיבי ה-breakdown בעברית. מונע מצב שבו המודל/הממשק
// ממציא תווית שגויה (למשל "שווי שימוש" במקום "בסיס מס"). שווי השימוש הוא
// *קלט* (על הרכב), לא רכיב ב-breakdown; לכן אינו מופיע כאן.

import type { NetBreakdown } from "../contracts/types.js";

/** תווית עברית מדויקת לכל רכיב breakdown, לפי משמעותו במנוע. */
export const BREAKDOWN_LABELS: Record<keyof NetBreakdown, string> = {
  cashSalary: "שכר מזומן (ברוטו)",
  taxableIncome: "בסיס מס (הכנסה חייבת)",
  insuranceBase: "בסיס ביטוח לאומי",
  incomeTax: "מס הכנסה",
  nationalInsurance: "ביטוח לאומי",
  health: "ביטוח בריאות",
  pensionEmployee: "הפרשת עובד לפנסיה",
  trainingEmployee: "הפרשת עובד לקרן השתלמות",
  participation: "השתתפות ברכב",
  familyGap: "פער מסלול משפחתי",
  electricGrossUp: "גילום החזר חשמל",
  pensionCredit: "זיכוי בגין פנסיה",
  creditPointsCredit: "זיכוי נקודות זיכוי",
};

/**
 * ממיר breakdown גולמי (שמות שדה באנגלית) לרשומה עם תווית עברית נכונה + ערך.
 * כך המודל/הממשק מתייחסים לרכיב לפי משמעותו האמיתית ולא לפי ניחוש.
 */
export function labeledBreakdown(b: NetBreakdown): Array<{ key: keyof NetBreakdown; label: string; value: string }> {
  return (Object.keys(BREAKDOWN_LABELS) as Array<keyof NetBreakdown>).map((k) => ({
    key: k,
    label: BREAKDOWN_LABELS[k],
    value: b[k],
  }));
}