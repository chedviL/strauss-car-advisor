// src/server/agent/fast-path.ts
// חתך מבני (דגל CHAT_FAST_PATH): קריאת-מודל-אחת שמחזירה *תוכנית פעולות מובנית*
// (מרשימה סגורה) + תשובה/שאלת הבהרה. הקוד מאמת ומבצע את הפעולות לפי הסדר, על
// תמונת מצב אחת שמתעדכנת מתוצאות השירות (ללא טעינה חוזרת פר-פעולה). חישוב/זכאות
// בקוד. אין שפת תכנות כללית ואין מתכנן — רק פעולות שתואמות לחוזי השירות הקיימים.

import { generateObject } from "ai";
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
]);

const planSchema = z.object({
  actions: z.array(actionSchema).max(4),
  // תשובה טבעית קצרה (ללא טענת-ביצוע; האישור יתווסף אחרי שמירה מוצלחת).
  reply: z.string(),
  // אם הבקשה עמומה לבחירת פעולה - שאלת הבהרה (ואז actions ריק).
  clarify: z.boolean().default(false),
  // בקשה שאינה בתחום הפעולות הסגורות (חיפוש רכבים חופשי, פירוט השוואה קודמת,
  // פנייה לנציג) -> מעבר למסלול הכלים המלא. actions יישאר ריק.
  handoff: z.boolean().default(false),
});

export interface FastPathOutcome {
  // כשצריך מסלול כלים מלא (חיפוש/פירוט/פנייה). עדכונים שכבר בוצעו מדווחים ב-did.
  handoff: boolean;
  reply: string;
  // סיכום מובנה לרענון UI / נרטיב אופציונלי.
  did: { facts: boolean; simulation: boolean; clearedSimulation: boolean; compared: boolean };
  compareRunId?: string;
  // דיווח מדויק של כשל חלקי (מה נשמר, מה לא).
  partialFailure?: string;
  conflict: boolean;
}

const SYSTEM = `את/ה היועץ/ת של שטראוס. החזר/י *תוכנית פעולות* מובנית לביצוע ההודעה הנוכחית,
מתוך הרשימה הסגורה בלבד, בסדר הנכון. אל תמציא/י פעולות או שדות.

סוגי פעולות:
- update_facts: תיקון/עדכון עובדה אמיתית ("השכר שלי 18,500", "יש לי 3 ילדים"). set=ערכים
  (0 הוא אפס אמיתי); clear=החזרת שדה ל"לא ידוע". כסף בשקלים; שיעורים כשבר (0.06=6%).
- set_simulation: שינוי היפותטי ("מה אם השכר יעלה ל-X", "מה אם הבונוס 3000") - שכר/עמלות/
  בונוס בלבד, לא עובדה אמיתית, לא משנה baseline.
- clear_simulation: ביטול השינוי ההיפותטי.
- compare: בקשת השוואת נטו ("מה יחסוך לי", "תשווי חשמליים"). mode=discover לסריקה
  (propulsion="3" לחשמליים, includeWaiver לכלול ויתור), או explicit עם vehicleCodes.

סדר: תיקון עובדה/סימולציה לפני compare. בקשה משולבת ("תקני שכר ל-19,000 ותשווי חשמליים")
= [update_facts, compare]. ברכה/שאלת הבהרה = actions ריק + reply (clarify=true אם עמום).

handoff=true (ו-actions ריק) כאשר הבקשה דורשת יכולת שאינה ברשימה הסגורה:
- חיפוש רכבים חופשי לפי מאפיין ("אילו רכבים חשמליים קיימים?", סינון מורכב).
- פירוט/הסבר על השוואה קודמת ("למה דווקא זה?", "מה במקום השישי?", "תראה את כולן").
- פנייה לנציג ("לא יודעת את ההשתתפות, אפשר לברר?"). עדיין אפשר לכלול update_facts
  לפני ה-handoff אם ההודעה כוללת גם תיקון, כדי לא לאבד אותו.

סגנון ה-reply (חשוב):
- אל תתאר/י ניהול נתונים פנימי. אסור: "אני רושם/ת", "עדכנתי את הרשימה", "שמרתי את השכר",
  "עכשיו אפעיל חישוב". פשוט השתמש/י במידע והתקדם/י: ענה/י לבקשה, שאל/י שאלה נחוצה, או הצג/י תוצאה.
- אל תחזור/י על כל נתון שנמסר ואל תאשר/י קבלה בכל תור. אישור קצר רק כשהוא מונע אי-הבנה
  (למשל בתיקון שכר, או בהבחנה בין סימולציה למצב הנוכחי).
- דוגמה (לא תסריט): עובדת "אני מרוויחה 15,000", והרכב הנוכחי חסר -> "איזה רכב יש לך היום?".
- סכומים בספרות ובפורמט מתאים. הנתונים המסודרים מופיעים בכרטיס/בממשק - אל תקריא/י אותם בכל הודעה.
- אל תסביר/י תוצאת השוואה שטרם חושבה; הסבר מבוסס-תוצאה יינתן רק אחרי שהתקבלה.
- שמור/י על היכולת לענות לשאלות ולשנות כיוון; זו הנחיית סגנון, לא תבנית קבועה.`;

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
  const did = { facts: false, simulation: false, clearedSimulation: false, compared: false };
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
        if (result.status === "ok") { did.compared = true; compareRunId = result.compareRunId; }
        else partialFailure = "חסרים נתונים לחישוב ההשוואה; לא הצגתי נטו.";
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

  return {
    handoff: object.handoff === true,
    reply, did, conflict,
    ...(compareRunId ? { compareRunId } : {}),
    ...(partialFailure ? { partialFailure } : {}),
  };
}