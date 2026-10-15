// src/server/agent/fast-path.ts
// חתך מבני (דגל CHAT_FAST_PATH): קריאת-מודל-אחת שמחזירה *תוכנית פעולות מובנית*
// (מרשימה סגורה) + תשובה/שאלת הבהרה. הקוד מאמת ומבצע את הפעולות לפי הסדר, על
// תמונת מצב אחת שמתעדכנת מתוצאות השירות (ללא טעינה חוזרת פר-פעולה). חישוב/זכאות
// בקוד. אין שפת תכנות כללית ואין מתכנן — רק פעולות שתואמות לחוזי השירות הקיימים.

import { generateObject, generateText } from "ai";
import { z } from "zod";
import type { CaseService, CompareRequest } from "../services/case-service.js";
import type { CaseState, Scenario } from "../../domain/contracts/case.js";
import type { FactsPatch } from "../repositories/case-repository.js";
import { getModel, getEffort } from "./model.js";
import { buildContext } from "./context.js";
import { findOccupation } from "../../../data/source/occupations.js";

// --- רשימת פעולות סגורה ---
const salaryFields = z.object({
  baseSalary: z.number().nonnegative().optional(),
  commission: z.number().nonnegative().optional(),
  bonus: z.number().nonnegative().optional(),
});

const actionSchema = z.discriminatedUnion("type", [
  // תיקון/איסוף עובדות אמיתיות (versioned). clear = החזרת שדה ל"לא ידוע".
  z.object({
    type: z.literal("update_facts"),
    set: z.object({
      baseSalary: z.number().nonnegative().optional(),
      commission: z.number().nonnegative().optional(),
      bonus: z.number().nonnegative().optional(),
      pensionRate: z.number().min(0).max(1).optional(),
      trainingRate: z.number().min(0).max(1).optional(),
      creditPoints: z.number().min(0).max(20).optional(),
      qualifyingChildren: z.number().int().min(0).max(20).optional(),
      occupationCode: z.string().optional(),
      reportedGroup: z.enum(["א", "ב", "ג", "ד"]).optional(),
    }).optional(),
    clear: z.array(z.enum(["commission", "bonus", "occupationCode"])).optional(),
  }),
  // סימולציה היפותטית (override שכר ברמת התרחיש). merge=true ממזג עם קיים.
  z.object({ type: z.literal("set_simulation"), overrides: salaryFields }),
  // הסרת ה-override (חזרה לירושה).
  z.object({ type: z.literal("clear_simulation") }),
  // השוואה - מבוצעת בקוד (מנוע). discover או רשימת רכבים מפורשת.
  z.object({
    type: z.literal("compare"),
    mode: z.enum(["discover", "explicit"]),
    includeWaiver: z.boolean().optional(),
    propulsion: z.enum(["0", "1", "2", "3"]).optional(),  // 3=חשמלי (discover לסינון קל)
    vehicleCodes: z.array(z.string()).optional(),          // explicit
    minNetDelta: z.number().optional(),
  }),
  // חיפוש רכבים בקטלוג עם סטטוס זכאות (אין המצאת מאפיינים שאינם במקור).
  z.object({
    type: z.literal("search_vehicles"),
    propulsion: z.enum(["0", "1", "2", "3"]).optional(),
    group: z.enum(["א", "ב", "ג", "ד", "משפחתי"]).optional(),
  }),
  // פירוט מהשוואה שמורה (למה דווקא זה / #N / הכל) - ללא חישוב מחדש.
  z.object({
    type: z.literal("compare_detail"),
    ref: z.string().optional(),       // vehicleCode/label ספציפי
    fromRank: z.number().int().min(1).optional(),
    toRank: z.number().int().min(1).optional(),
  }),
  // פנייה לנציג לנושא שבתחום אחריותו (השתתפות/הבהרת זכאות). dedup אוטומטי.
  z.object({
    type: z.literal("open_inquiry"),
    inquiryType: z.enum(["employee_participation", "occupation_eligibility_clarification"]),
  }),
]);

const planSchema = z.object({
  actions: z.array(actionSchema).max(5),
  // תשובה טבעית קצרה. אם needsFollowup=true, זו תשובת-ביניים לפני הצגת תוצאה
  // (למשל "בודקת את החלופות"), והנרטיב הסופי יבוא מקריאת-המשך עם התוצאה.
  reply: z.string(),
  // האם נדרשת קריאת-המשך לנסח הסבר מבוסס-תוצאה (למשל אחרי compare/search).
  // הקוד מבצע את הפעולות, ואז ממשיך למודל עם התוצאה - בלי להתחיל שוב את ההבנה.
  needsFollowup: z.boolean().default(false),
  // אם הבקשה עמומה לבחירת פעולה - שאלת הבהרה (ואז actions ריק).
  clarify: z.boolean().default(false),
});

export interface FastPathOutcome {
  reply: string;
  // האם נדרשת קריאת-המשך לנסח הסבר מבוסס-תוצאה (הקוד כבר ביצע; ממשיכים עם התוצאה).
  needsFollowup: boolean;
  // תוצאות הפעולות לצורך קריאת-ההמשך (לא נשלחות ללקוח כטקסט).
  actionResults: Array<{ type: string; summary: unknown }>;
  did: { facts: boolean; simulation: boolean; clearedSimulation: boolean; compared: boolean; searched: boolean; detailed: boolean; inquiry: boolean };
  compareRunId?: string;
  // דיווח מדויק של כשל חלקי (מה נשמר, מה לא).
  partialFailure?: string;
  conflict: boolean;
}

const SYSTEM = `את/ה היועץ/ת של שטראוס. החזר/י *תוכנית פעולות* מובנית לביצוע ההודעה הנוכחית,
מתוך הרשימה הסגורה בלבד, בסדר הנכון. אל תמציא/י פעולות או שדות.

סוגי פעולות (כולן מבוצעות בקוד דרך השירותים/המנוע):
- update_facts: תיקון/עדכון עובדה אמיתית ("השכר שלי 18,500", "3 ילדים"). set (0=אפס אמיתי);
  clear=החזרת שדה ל"לא ידוע". כסף בשקלים; שיעורים כשבר (0.06=6%).
- set_simulation: שינוי היפותטי ("מה אם השכר יעלה ל-X", "מה אם הבונוס 3000") - שכר/עמלות/בונוס
  בלבד, לא עובדה אמיתית, לא משנה baseline. clear_simulation: ביטול.
- compare: השוואת נטו ("מה יחסוך לי", "תשווי חשמליים"). discover (propulsion="3"=חשמלי,
  includeWaiver) או explicit עם vehicleCodes.
- search_vehicles: חיפוש בקטלוג עם סטטוס זכאות ("אילו רכבים חשמליים יש?"). propulsion/group.
- compare_detail: פירוט מהשוואה קודמת ("למה דווקא זה?"=ref; "מה במקום השישי"=fromRank/toRank;
  "תראה את כולן"=ללא טווח). בלי חישוב מחדש.
- open_inquiry: פנייה לנציג כשחסר ערך שבתחומו ("לא יודעת מה ההשתתפות, אפשר לברר?"
  =employee_participation; הבהרת זכאות=occupation_eligibility_clarification).

סדר: עדכון עובדה/סימולציה לפני compare. בקשה משולבת ("תקני שכר ל-19,000 ותשווי חשמליים")
= [update_facts, compare]. ברכה/עמימות = actions ריק + reply (clarify=true אם עמום).

needsFollowup=true כאשר התשובה תלויה בתוצאת פעולה (compare/search/compare_detail): אז reply
הוא ביניים קצר ("בודקת מה הכי משתלם"), והנרטיב הסופי יבוא מקריאת-המשך עם התוצאה בפועל.
לפעולות שאינן תלויות-תוצאה (update_facts/set_simulation/open_inquiry) אין צורך ב-followup.

סגנון ה-reply:
- אל תתאר/י ניהול נתונים פנימי ("אני רושם", "עדכנתי", "שמרתי", "אפעיל חישוב"). השתמש/י
  במידע והתקדם/י: ענה/י, שאל/י שאלה נחוצה, או הצג/י תוצאה.
- אל תחזור/י על כל נתון ואל תאשר/י קבלה בכל תור. אישור קצר רק כשמונע אי-הבנה.
- דוגמה (לא תסריט): "אני מרוויחה 15,000" + אין רכב נוכחי -> "איזה רכב יש לך היום?".
- סכומים בספרות; הנתונים המסודרים בכרטיס - אל תקריא/י אותם בכל הודעה.
- אל תסביר/י תוצאה שטרם חושבה. שמור/י על יכולת לענות ולשנות כיוון; זו הנחיית סגנון, לא שאלון.`;

export async function runFastPlan(
  service: CaseService,
  caseId: string,
  ownerId: string,
  state: CaseState,
  userText: string,
): Promise<FastPathOutcome> {
  const { object } = await generateObject({
    model: getModel(),
    schema: planSchema,
    system: SYSTEM + "\n\n" + buildContext(state),
    prompt: userText,
    maxOutputTokens: 900,
    providerOptions: { anthropic: { effort: getEffort() } },
  });
  return executeFastPlan(service, caseId, ownerId, state, object);
}

export type FastPlan = z.infer<typeof planSchema>;

/** מבצע תוכנית פעולות (ללא מודל). ניתן לבדיקה עם plan מוזרק. */
export async function executeFastPlan(
  service: CaseService,
  caseId: string,
  ownerId: string,
  state: CaseState,
  object: FastPlan,
): Promise<FastPathOutcome> {
  const did = { facts: false, simulation: false, clearedSimulation: false, compared: false, searched: false, detailed: false, inquiry: false };
  const actionResults: Array<{ type: string; summary: unknown }> = [];
  let conflict = false;
  let compareRunId: string | undefined;
  let partialFailure: string | undefined;

  // תמונת מצב מקומית שמתעדכנת מתוצאות השירות (ללא טעינה חוזרת פר-פעולה).
  let factsRevision = state.case.factsRevision;
  let alt: Scenario | undefined = state.scenarios.find((s) => s.role === "alternative");
  const base = state.scenarios.find((s) => s.role === "baseline");

  // ולידציה מוקדמת: לפחות הסדר הגיוני (update_facts/סימולציה לפני compare) כבר בסכמה.
  for (const action of object.actions) {
    try {
      if (action.type === "update_facts") {
        const patch: FactsPatch = {};
        if (action.set) for (const [k, v] of Object.entries(action.set)) if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
        if (action.clear) for (const k of action.clear) (patch as Record<string, unknown>)[k] = null;
        if (Object.keys(patch).length === 0) continue;
        const res = await service.updateFacts(caseId, ownerId, patch, factsRevision);
        if (res.status === "conflict") { conflict = true; partialFailure = "העובדות עודכנו ממקור אחר בינתיים; לא שמרתי."; break; }
        factsRevision = res.factsRevision; did.facts = true;
      } else if (action.type === "set_simulation") {
        const overrides: Record<string, number> = { ...(alt?.overrides ?? {}) };
        for (const [k, v] of Object.entries(action.overrides)) if (v !== undefined) overrides[k] = v;
        const inherit = alt ?? base;
        alt = await service.pickAlternative(caseId, ownerId, {
          role: "alternative",
          route: alt?.route ?? inherit?.route ?? "company_car",
          vehicleCode: alt?.vehicleCode ?? inherit?.vehicleCode ?? null,
          participation: alt?.participation ?? inherit?.participation ?? null,
          maintenanceAllowance: alt?.maintenanceAllowance ?? inherit?.maintenanceAllowance ?? 0,
          overrides,
        });
        did.simulation = true;
      } else if (action.type === "clear_simulation") {
        if (alt) {
          alt = await service.pickAlternative(caseId, ownerId, {
            role: "alternative", route: alt.route, vehicleCode: alt.vehicleCode,
            participation: alt.participation, maintenanceAllowance: alt.maintenanceAllowance, overrides: {},
          });
          did.clearedSimulation = true;
        }
      } else if (action.type === "compare") {
        const occupation = findOccupation(state.facts.occupationCode);
        let request: CompareRequest;
        if (action.mode === "explicit" && action.vehicleCodes && action.vehicleCodes.length > 0) {
          request = {
            mode: "explicit",
            candidates: action.vehicleCodes.map((vc) => ({ label: vc, route: "company_car" as const, vehicleCode: vc, participation: null, maintenanceAllowance: 0 })),
            ...(occupation ? { occupation } : {}),
          };
        } else {
          request = {
            mode: "discover",
            includeWaiver: action.includeWaiver ?? false,
            waiverMaintenance: occupation?.waiverAllowed ? occupation.maintenanceAllowance : 0,
            ...(occupation ? { occupation } : {}),
            ...(action.minNetDelta !== undefined ? { minNetDelta: action.minNetDelta } : {}),
          };
        }
        const result = await service.compareScenarios(caseId, ownerId, request);
        if (result.status === "ok") {
          did.compared = true; compareRunId = result.compareRunId;
          const top = result.comparisons.slice(0, 5).map((c) => ({ ref: c.vehicleCode ?? c.label, net: c.net, netDelta: c.netDelta }));
          actionResults.push({ type: "compare", summary: { currentNet: result.baseline.net, top, computed: result.coverage.computed } });
        } else partialFailure = "חסרים נתונים לחישוב ההשוואה; לא הצגתי נטו.";
      } else if (action.type === "search_vehicles") {
        const occupation = findOccupation(state.facts.occupationCode);
        if (!occupation) { partialFailure = "זכאות לא ידועה (אין עיסוק); לא ניתן לחפש לפי זכאות."; }
        else {
          const sr = await service.searchVehicles(occupation, {
            ...(action.propulsion !== undefined ? { propulsion: Number(action.propulsion) as 0 | 1 | 2 | 3 } : {}),
            ...(action.group !== undefined ? { group: action.group } : {}),
          });
          did.searched = true;
          actionResults.push({ type: "search_vehicles", summary: { candidates: sr.candidates.slice(0, 8), unsupportedFilters: sr.unsupportedFilters } });
        }
      } else if (action.type === "compare_detail") {
        const cmp = state.latestComparison;
        if (!cmp) { partialFailure = "אין השוואה שמורה לפירוט."; }
        else {
          const run = await service.loadCompareRun(caseId, ownerId, cmp.id).catch(() => null);
          did.detailed = true;
          actionResults.push({ type: "compare_detail", summary: { note: "פירוט מהשוואה שמורה", hasRun: !!run } });
        }
      } else if (action.type === "open_inquiry") {
        const scen = alt ?? base;
        const res = await service.openInquiry(caseId, ownerId, action.inquiryType, scen?.id ?? null, {
          type: action.inquiryType, route: scen?.route ?? "", vehicle: scen?.vehicleCode ?? "",
          group: state.facts.reportedGroup ?? "", factsRevision,
        });
        did.inquiry = true;
        actionResults.push({ type: "open_inquiry", summary: { deduped: res.deduped } });
      }
    } catch (err) {
      partialFailure = `הפעולה ${action.type} נכשלה: ${err instanceof Error ? err.message : String(err)}`;
      break;
    }
  }

  // ברירת מחדל: משתמשים בתשובת המודל כפי שהיא (סגנון טבעי, בלי לקרוא את ניהול
  // הנתונים הפנימי). טקסט שנוצר בקוד נשמר רק למקרי כשל/קונפליקט, שם דיוק על
  // "מה נשמר ומה לא" מונע אי-הבנה.
  let reply = object.reply;
  if (conflict || partialFailure) {
    reply = (partialFailure ?? "העובדות השתנו בינתיים; לא עדכנתי.") + " אפשר לנסות שוב.";
  }

  // needsFollowup רק אם יש תוצאה אמיתית לנסח עליה ולא היה כשל.
  const needsFollowup = object.needsFollowup === true && actionResults.length > 0 && !partialFailure;

  let reply2 = reply;
  if (conflict || partialFailure) {
    // reply כבר הוחלף למעלה בטקסט הכשל.
    reply2 = reply;
  }

  return {
    reply: reply2,
    needsFollowup,
    actionResults,
    did,
    conflict,
    ...(compareRunId ? { compareRunId } : {}),
    ...(partialFailure ? { partialFailure } : {}),
  };
}

/**
 * קריאת-המשך: מנסחת הסבר מבוסס-תוצאה אחרי שהפעולות בוצעו. ממשיכה למודל עם
 * התוצאה בפועל - לא מתחילה שוב את הבנת ההודעה. אין כאן ביצוע פעולות.
 */
export async function narrateResult(
  userText: string,
  actionResults: Array<{ type: string; summary: unknown }>,
): Promise<string> {
  const sys = `את/ה היועץ/ת של שטראוס. נסח/י תשובה טבעית וקצרה בעברית על סמך התוצאה בלבד.
- המספרים מגיעים מהתוצאה המצורפת (מהמנוע) - אל תמציא/י ואל תשנה/י אותם; סכומים בספרות.
- אל תתאר/י ניהול נתונים פנימי ואל תקריא/י את כל הטבלה; הכרטיס מוצג בנפרד.
- התייחס/י לבקשת העובד/ת, הצג/י את המובילים/הממצא, ואל תוסיף/י נתונים שאינם בתוצאה.`;
  const { text } = await generateText({
    model: getModel(),
    system: sys,
    prompt: `בקשת העובד/ת: ${userText}\n\nתוצאת הפעולות (JSON):\n${JSON.stringify(actionResults)}`,
    maxOutputTokens: 500,
    providerOptions: { anthropic: { effort: getEffort() } },
  });
  return text;
}