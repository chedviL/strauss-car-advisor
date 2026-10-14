// src/domain/calculation/rule-set-loader.ts
// טעינת גרסת כללים מ-JSON, אימות מבנה (Zod), וחישוב content hash.
// גרסאות rule-set מובחנות לפי התוכן ולא לפי מחרוזת version (design §2.1).

import { createHash } from "node:crypto";
import { z } from "zod";
import type { RuleSet } from "../contracts/types.js";

const bracketTuple = z.tuple([z.number().nullable(), z.number()]);

const twoRate = z.object({
  threshold: z.number(),
  ceiling: z.number(),
  lowRate: z.number(),
  highRate: z.number(),
});

/** סכמת ה-JSON הגולמי כפי שפורסם ע"י מארגני האתגר. */
const rawRulesSchema = z.object({
  version: z.string(),
  budgets: z.record(z.string(), z.number()),
  groupOrder: z.array(z.string()),
  chooseFrom: z.literal("own_group_or_lower"),
  electric: z.object({
    netBonus: z.number(),
    method: z.enum(["gross_up", "gross_fixed"]).default("gross_up"),
  }),
  familyTrack: z.object({
    minChildren: z.number(),
    childMaxAge: z.number(),
    // הקובץ המעודכן: cars + priceSource. הקובץ הישן: carPrice.
    cars: z.array(z.string()).optional(),
    priceSource: z.literal("catalogue").optional(),
    carPrice: z.number().optional(),
    gapSplitEmployee: z.number(),
  }),
  waiver: z.object({
    allowedBy: z.literal("occupation"),
    maintenanceIsTaxable: z.boolean(),
    maintenanceIsPensionable: z.boolean(),
  }),
  unusedBudget: z.literal("not_paid"),
  netMethod: z.object({
    basis: z.literal("monthly"),
    taxYear: z.number(),
    creditPointValue: z.number(),
    brackets: z.array(bracketTuple),
    nationalInsurance: twoRate,
    health: twoRate,
    pensionCredit: z.object({
      rate: z.number(),
      // הקובץ המעודכן מוסיף maxContributionRate.
      maxContributionRate: z.number().optional(),
      incomeCeiling: z.number(),
    }),
    // שדות הקובץ המעודכן (אופציונליים לתאימות לאחור):
    contributionsBase: z.enum(["gross", "base_only"]).optional(),
    participation: z
      .object({
        treatment: z.literal("net_deduction"),
        reducesValueOfUse: z.boolean(),
      })
      .optional(),
    rounding: z
      .object({
        during: z.enum(["none", "agora"]),
        display: z.enum(["shekel", "agora"]),
      })
      .optional(),
  }),
  valueOfUse: z.object({
    source: z.string(),
    key: z.array(z.string()),
    driveField: z.record(z.string(), z.string()),
  }),
});

export type RawRules = z.infer<typeof rawRulesSchema>;

export function computeContentHash(rawJsonText: string): string {
  return createHash("sha256").update(rawJsonText, "utf8").digest("hex");
}

/**
 * מנרמל את ה-JSON הגולמי ל-RuleSet, כולל תאימות לאחור:
 * - contributionsBase: אם חסר, ברירת מחדל "gross" (מודל האתגר).
 * - pensionCredit.maxContributionRate: אם חסר, ברירת מחדל 0.07.
 * - rounding: אם חסר, ברירת מחדל {during:"none", display:"shekel"}.
 * - participation: אם חסר, ברירת מחדל {net_deduction, reducesValueOfUse:false}.
 * - familyTrack: אם יש carPrice ישן ואין cars - נשמר priceSource="catalogue"
 *   עם רשימת רכבים ריקה (העלויות מגיעות מהקטלוג בכל מקרה).
 * כל ברירת מחדל שהופעלה נרשמת ב-appliedDefaults לשקיפות.
 */
export function normalizeRules(
  raw: RawRules,
  rawJsonText: string,
): { rules: RuleSet; appliedDefaults: string[] } {
  const appliedDefaults: string[] = [];
  const nm = raw.netMethod;

  let contributionsBase = nm.contributionsBase;
  if (contributionsBase === undefined) {
    contributionsBase = "gross";
    appliedDefaults.push('netMethod.contributionsBase=gross (ברירת מחדל)');
  }

  let maxContributionRate = nm.pensionCredit.maxContributionRate;
  if (maxContributionRate === undefined) {
    maxContributionRate = 0.07;
    appliedDefaults.push(
      "netMethod.pensionCredit.maxContributionRate=0.07 (ברירת מחדל)",
    );
  }

  let rounding = nm.rounding;
  if (rounding === undefined) {
    rounding = { during: "none", display: "shekel" };
    appliedDefaults.push(
      'netMethod.rounding={during:none,display:shekel} (ברירת מחדל)',
    );
  }

  let participation = nm.participation;
  if (participation === undefined) {
    participation = { treatment: "net_deduction", reducesValueOfUse: false };
    appliedDefaults.push(
      "netMethod.participation (ברירת מחדל: net_deduction, reducesValueOfUse=false)",
    );
  }

  let cars = raw.familyTrack.cars;
  if (cars === undefined) {
    cars = [];
    appliedDefaults.push(
      "familyTrack.cars לא נמצא (קובץ ישן) - העלויות ייקבעו מהקטלוג",
    );
  }

  const rules: RuleSet = {
    version: raw.version,
    contentHash: computeContentHash(rawJsonText),
    budgets: raw.budgets,
    groupOrder: raw.groupOrder,
    chooseFrom: raw.chooseFrom,
    electric: { netBonus: raw.electric.netBonus, method: raw.electric.method },
    familyTrack: {
      minChildren: raw.familyTrack.minChildren,
      childMaxAge: raw.familyTrack.childMaxAge,
      cars,
      priceSource: "catalogue",
      gapSplitEmployee: raw.familyTrack.gapSplitEmployee,
    },
    waiver: raw.waiver,
    unusedBudget: raw.unusedBudget,
    netMethod: {
      basis: nm.basis,
      taxYear: nm.taxYear,
      creditPointValue: nm.creditPointValue,
      brackets: nm.brackets.map(([upTo, rate]) => ({ upTo, rate })),
      nationalInsurance: nm.nationalInsurance,
      health: nm.health,
      pensionCredit: {
        rate: nm.pensionCredit.rate,
        maxContributionRate,
        incomeCeiling: nm.pensionCredit.incomeCeiling,
      },
      contributionsBase,
      participation,
      rounding,
    },
    valueOfUse: raw.valueOfUse,
  };

  return { rules, appliedDefaults };
}

export function parseRules(rawJsonText: string): {
  rules: RuleSet;
  appliedDefaults: string[];
} {
  const parsed = rawRulesSchema.parse(JSON.parse(rawJsonText));
  return normalizeRules(parsed, rawJsonText);
}
