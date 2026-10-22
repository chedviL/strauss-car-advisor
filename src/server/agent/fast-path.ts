// src/server/agent/fast-path.ts
// חתך מבני (דגל CHAT_FAST_PATH): קריאת-מודל-אחת שמחזירה *תוכנית פעולות מובנית*
// (מרשימה סגורה) + תשובה/שאלת הבהרה. הקוד מאמת ומבצע את הפעולות לפי הסדר, על
// תמונת מצב אחת שמתעדכנת מתוצאות השירות (ללא טעינה חוזרת פר-פעולה). חישוב/זכאות
// בקוד. אין שפת תכנות כללית ואין מתכנן — רק פעולות שתואמות לחוזי השירות הקיימים.

import { generateObject, generateText, type ModelMessage } from "ai";
import { z } from "zod";
import type { CaseService, CompareRequest } from "../services/case-service.js";
import type { CaseState, Scenario } from "../../domain/contracts/case.js";
import type { FactsPatch } from "../repositories/case-repository.js";
import { getModel, getEffort } from "./model.js";
import { buildContext } from "./context.js";
import { occupationOrGroup } from "../../../data/source/occupations.js";

/**
 * זכאות לרכב חברה נקבעת לפי קבוצת הזכאות. אם העיסוק ידוע -> משתמשים בו (כולל
 * דגלי ויתור/רכב-חובה). אחרת, אם נמסרה קבוצה -> בונים זכאות לפי קבוצה (לרכב חברה
 * בלבד; ויתור דורש עיסוק מאומת). null רק אם אין עיסוק ואין קבוצה.
 */
// תוויות עבריות לשדות חסרים, כדי לשאול על מה שחסר במקום הודעה כללית.
const FIELD_LABEL: Record<string, string> = {
  baseSalary: "שכר הבסיס החודשי", commission: "עמלות", bonus: "בונוס",
  pensionRate: "שיעור הפנסיה", trainingRate: "שיעור קרן ההשתלמות",
  creditPoints: "נקודות זיכוי", qualifyingChildren: "מספר הילדים",
  reportedGroup: "קבוצת הזכאות", occupationCode: "העיסוק",
  vehicleCode: "הרכב", participation: "ההשתתפות ברכב",
};
function labelMissing(fields: string[]): string {
  const labels = fields.map((f) => FIELD_LABEL[f.replace(/^vehicle:.*/, "vehicleCode")] ?? f);
  return [...new Set(labels)].join(", ");
}


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
  // הרכב הנוכחי של העובד/ת ("יש לי Atto 3") - מתעדכן ב-baseline (המצב הקיים),
  // לא כרכב יעד להשוואה. vehicleCode מהקטלוג (אם זוהה).
  z.object({ type: z.literal("set_current_vehicle"), vehicleCode: z.string() }),
  // השוואה - מבוצעת בקוד (מנוע). discover או רשימת רכבים מפורשת.
  z.object({
    type: z.literal("compare"),
    mode: z.enum(["discover", "explicit"]),
    includeWaiver: z.boolean().optional(),
    propulsion: z.enum(["0", "1", "2", "3"]).optional(),  // 3=חשמלי (discover לסינון קל)
    vehicleCodes: z.array(z.string()).optional(),          // explicit
  }),
  // חיפוש רכבים בקטלוג עם סטטוס זכאות (אין המצאת מאפיינים שאינם במקור).
  z.object({
    type: z.literal("search_vehicles"),
    propulsion: z.enum(["0", "1", "2", "3"]).optional(),
    group: z.enum(["א", "ב", "ג", "ד", "משפחתי"]).optional(),
    /** שם מסחרי לזיהוי רכב (Atto 3, Dolphin) - מחזיר vehicleCode מאומת */
    name: z.string().optional(),
  }),
  // פירוט מהשוואה שמורה (למה דווקא זה / #N / הכל) - ללא חישוב מחדש.
  z.object({
    type: z.literal("compare_detail"),
    ref: z.string().optional(),       // vehicleCode/label ספציפי ל"למה דווקא זה"
    topN: z.number().int().min(1).optional(),  // כמה מובילות להציג ("תראה את כולן"=גדול)
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
  did: { facts: boolean; simulation: boolean; clearedSimulation: boolean; currentVehicle: boolean; compared: boolean; searched: boolean; detailed: boolean; inquiry: boolean };
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
- search_vehicles: חיפוש בקטלוג עם סטטוס זכאות. name=שם מסחרי (Atto 3, Dolphin) לזיהוי רכב
  -> מחזיר vehicleCode מאומת; propulsion/group לסינון רשימה. אין לנחש vehicleCode — הכנס/י name ותקבל/י קוד.
- compare_detail: פירוט מהשוואה קודמת ("למה דווקא זה?"=ref; "תראה את כולן"=topN גדול;
  "תראה את כולן"=ללא טווח). בלי חישוב מחדש.
- set_current_vehicle: הרכב הנוכחי של העובד/ת ("יש לי Atto 3", "אני נוסע/ת היום בטויוטה")
  -> מתעדכן כמצב הקיים (baseline), לא כרכב יעד להשוואה. vehicleCode מהקטלוג.
- open_inquiry: פנייה לנציג כשחסר ערך שבתחומו ("לא יודעת מה ההשתתפות, אפשר לברר?"
  =employee_participation; הבהרת זכאות=occupation_eligibility_clarification).

## מטרה והמשכיות (חשוב)
- הבחן/י בין *מידע שנמסר* (שכר/קבוצה/רכב נוכחי) לבין *מה שהעובד/ת רוצה לברר* (המטרה).
- אם המטרה עדיין לא ידועה (ברכה/שם/פרט בודד) - שאל/י בקצרה מה היעד. אל תתחיל/י לאסוף
  שכר/עיסוק/השתתפות לפני שברור מה רוצים לחשב.
- **המשכיות:** אם ההודעה האחרונה עונה על שאלה ששאלת בתור הקודם (למשל שאלת שכר ->
  "15000 בלי" = שכר 15,000, בלי עמלות/בונוס) - פענח/י אותה בהקשר, עדכן/י, והמשך/י את
  הבקשה שכבר נמסרה (למשל ההשוואה שהתבקשה). אל תשאל/י שוב "מה המטרה" כשהיא כבר ידועה
  מההיסטוריה. בקשת השוואה שנעצרה על מידע חסר נשארת פעילה - השלם/י אותה כשהמידע הגיע.
- שאל/י רק על מה שחסר *לפעולה המבוקשת*, לא על כל שדה חסר בתיק. ברכה/שם -> ברך/י והצע/י עזרה.

## זכאות
- זכאות לרכב חברה נקבעת לפי *קבוצת הזכאות*. אם נמסרה קבוצה (למשל "ג") - אפשר לחפש/להשוות
  רכבי חברה גם בלי עיסוק. אל תאמר/י "בלי עיסוק אי אפשר לקבוע זכאות" - זה שגוי.
- העיסוק נדרש רק להחלטות ויתור/רכב-חובה. אם צריך את זה - בקש/י עיסוק, לא "חוסם זכאות כללי".

## זיהוי רכב לפי שם (חובה)
- כשהעובד/ת מזכיר/ה רכב בשם ("Atto 3", "דולפין", "קורולה") - קרא/י search_vehicles תחילה
  לאמת את הזיהוי ולקבל את vehicleCode המדויק. אל תנחש/י קוד על סמך שם בלבד.
- שני רכבים יכולים לחלוק יצרן (לדוגמה ATTO 3 ו-BYD DOLPHIN שניהם BYD) - אך הם קודים, קבוצות
  ושווי שימוש שונים לחלוטין. זיהוי שגוי ישנה את הנתונים, הקבוצה והמספרים.
- אחרי שמזוהה הרכב בשם → vehicleCode → לפי קוד זה בלבד compare/set_current_vehicle.

## שכר: ברוטו מול נטו
- כשמגיע סכום שכר ללא הקשר ברוטו/נטו — שאל/י "ברוטו או נטו?" פעם אחת לפני שמירה. אל תנחש/י.
- כבד/י הקשר: אם כבר נמסר "ברוטו", או ששאלת השכר הקודמת ביקשה ברוטו ונענתה — אל תשאל/י שוב.
  בירור מילה עמומה ("בלי" = בלי עמלות/בונוס) אינו מבטל סכום שכבר ברור: פענח/י את העמום והמשך/י.

## חוסר-נתונים: שאלה אחת, לא רשימה
- כשחסרים נתונים לחישוב, שאל/י על השדה *הכי חשוב* לפעולה המבוקשת - שאלה אחת ממוקדת.
  אל תקריא/י את כל missingFields כרשימה. עד שהנתונים מגיעים, אפשר להסביר מסלולים ולבדוק
  רכבים; ציין/י שאין עדיין תוצאת נטו.
- "מה אם ניחש?" / "אפשר להעריך?": סימולציה עם הנחות מפורשות *מותרת*, אבל רק אחרי שהעובד/ת
  בחר/ה בכך. הסבר/י מה מניחים (לדוגמה "אניח 6% פנסיה ו-2.75 נק' זיכוי") - וסמן/י את
  התוצאה כ"לפי הנחות". אין להציע ניחוש כבסיס לחישוב מלא ללא הסכמה מפורשת.

## תלוש שכר
- העלאת תלוש *זמינה* (PDF כולל סרוק, או תמונה). כש-נתון שכר חסר, הצע/י להעלות תלוש
  וכוון/י לאייקון הצירוף שליד תיבת ההקלדה. אל תאמר/י שאין אפשרות להעלות קבצים.
- לחלופין, אם מעדיפים ידנית: "בדוק/י בתלוש את שורת שכר הבסיס (ברוטו) ואת שיעור
  ההפרשה לפנסיה ולקרן ההשתלמות — לרוב מופיע אחוז ההפרשה, לא רק הסכום. נקודות
  הזיכוי עשויות להופיע גם בתלוש וגם בטופס 106." אל תניח/י מבנה תלוש קבוע.

סדר: עדכון עובדה/רכב-נוכחי/סימולציה לפני compare. בקשה משולבת = רשימת פעולות בסדר.
ברכה/עמימות = actions ריק + reply (clarify=true אם עמום).

needsFollowup=true כאשר התשובה תלויה בתוצאת פעולה (compare/search/compare_detail): אז reply
הוא ביניים קצר ("בודקת מה הכי משתלם"), והנרטיב הסופי יבוא מקריאת-המשך עם התוצאה בפועל.
לפעולות שאינן תלויות-תוצאה (update_facts/set_simulation/open_inquiry) אין צורך ב-followup.

## פנייה מגדרית
- ברירת מחדל: זכר (״שלך״, ״קיבלת״, ״בדוק״). שינוי רק על-פי רמז מפורש
  בהודעת המשתמש (״אני מקבלת/שייכת/עובדת״ -> נקבה; ״אני מקבל/שייך/עובד״ -> זכר).
- אל תנחש/י מגדר משם בלבד. שמור/י את ההעדפה לאורך כל השיחה.
- *אל תסביר/י את זיהוי המגדר או כל ניתוח פנימי בטקסט למשתמש/ת* (למשל 'כתבת ... רמז לנקבה'); פנה/י ישירות במגדר הנכון בלי להצהיר עליו.
- ניסוח ניטרלי עדיף על כפל-לשון (לדוגמה: ״כמה השכר?״ במקום ״מה השכר שלך/שלכם?״).
- הסר/י ניסוחים כמו ״תרצה/י״ — השתמש/י בשאלה ישירה (״מה הרכב?״ במקום ״מה הרכב שתרצה/י?״).

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
  history?: ModelMessage[],
): Promise<FastPathOutcome> {
  // מעבירים את ההיסטוריה האחרונה כדי שהמודל יראה את שאלת-ההשלמה הקודמת ואת
  // הבקשה המקורית (למשל בקשת השוואה שנעצרה על מידע חסר). כך תשובה קצרה כמו
  // "15000 בלי" נקשרת לשאלה ולבקשה הפתוחה, ולא מתפרשת כפתיחה חדשה.
  const recent = (history ?? []).slice(-10);
  const messages: ModelMessage[] =
    recent.length > 0 ? recent : [{ role: "user", content: userText }];
  const { object } = await generateObject({
    model: getModel(),
    schema: planSchema,
    system: SYSTEM + "\n\n" + buildContext(state),
    messages,
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
  const did = { facts: false, simulation: false, clearedSimulation: false, currentVehicle: false, compared: false, searched: false, detailed: false, inquiry: false };
  const actionResults: Array<{ type: string; summary: unknown }> = [];
  let conflict = false;
  let compareRunId: string | undefined;
  let partialFailure: string | undefined;

  // תמונת מצב מקומית שמתעדכנת מתוצאות השירות (ללא טעינה חוזרת פר-פעולה).
  let factsRevision = state.case.factsRevision;
  let facts = { ...state.facts };
  let alt: Scenario | undefined = state.scenarios.find((s) => s.role === "alternative");
  const base = state.scenarios.find((s) => s.role === "baseline");

  type PendingReq = import("../../domain/contracts/case.js").PendingRequest;
  // בניית CompareRequest לשירות מתוך תיאור בקשה (action או בקשה שמורה).
  function buildCompareRequest(spec: { mode: "discover" | "explicit"; vehicleCodes?: string[]; includeWaiver?: boolean }): CompareRequest {
    const occupation = occupationOrGroup(facts.occupationCode, facts.reportedGroup);
    if (spec.mode === "explicit" && spec.vehicleCodes && spec.vehicleCodes.length > 0) {
      return {
        mode: "explicit",
        candidates: spec.vehicleCodes.map((vc) => ({ label: vc, route: "company_car" as const, vehicleCode: vc, participation: null, maintenanceAllowance: 0 })),
        ...(occupation ? { occupation } : {}),
      };
    }
    return {
      mode: "discover",
      includeWaiver: spec.includeWaiver ?? false,
      waiverMaintenance: occupation?.waiverAllowed ? occupation.maintenanceAllowance : 0,
      ...(occupation ? { occupation } : {}),
    };
  }
  // מריץ השוואה; מחזיר true אם הצליחה (נשמר כרטיס). מעדכן did/actionResults/partialFailure.
  async function runCompare(spec: { mode: "discover" | "explicit"; vehicleCodes?: string[]; includeWaiver?: boolean }): Promise<boolean> {
    const result = await service.compareScenarios(caseId, ownerId, buildCompareRequest(spec));
    if (result.status === "ok") {
      did.compared = true; compareRunId = result.compareRunId;
      const top = result.comparisons.slice(0, 5).map((c) => ({ ref: c.vehicleCode ?? c.label, name: c.name, net: c.net, netDelta: c.netDelta }));
      actionResults.push({ type: "compare", summary: { currentNet: result.baseline.net, top, computed: result.coverage.computed } });
      return true;
    }
    const mf = (result as { missingFields?: string[] }).missingFields ?? [];
    partialFailure = mf.length > 0 ? `כדי לחשב את ההשוואה חסר: ${labelMissing(mf)}.` : "חסרים נתונים לחישוב ההשוואה.";
    return false;
  }
  // האם התוכנית כוללת שינוי כיוון/ביטול שמבטל בקשה פעילה.
  const changesDirection = object.actions.some((a) => a.type === "clear_simulation" || a.type === "search_vehicles" || a.type === "open_inquiry");
  let explicitCompareInPlan = false;

  // ולידציה מוקדמת: לפחות הסדר הגיוני (update_facts/סימולציה לפני compare) כבר בסכמה.
  // עובדות שנמסרו באותו תור חייבות להישמר לפני כל פעולה שתלויה בזכאות.
  // הסדר היחסי של שאר הפעולות נשמר (למשל בחירת רכב לפני השוואה).
  const orderedActions = [...object.actions].sort((a, b) =>
    Number(b.type === "update_facts") - Number(a.type === "update_facts"),
  );
  for (const action of orderedActions) {
    try {
      if (action.type === "update_facts") {
        const patch: FactsPatch = {};
        if (action.set) for (const [k, v] of Object.entries(action.set)) if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
        if (action.clear) for (const k of action.clear) (patch as Record<string, unknown>)[k] = null;
        if (Object.keys(patch).length === 0) continue;
        const res = await service.updateFacts(caseId, ownerId, patch, factsRevision);
        if (res.status === "conflict") { conflict = true; partialFailure = "העובדות עודכנו ממקור אחר בינתיים; לא שמרתי."; break; }
        factsRevision = res.factsRevision; did.facts = true;
        for (const [key, value] of Object.entries(patch)) {
          (facts as unknown as Record<string, unknown>)[key] = value;
        }
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
      } else if (action.type === "set_current_vehicle") {
        // הרכב הנוכחי -> baseline (לא רכב יעד). route=company_car כברירת מחדל.
        await service.updateBaselineVehicle(caseId, ownerId, {
          route: base?.route ?? "company_car",
          vehicleCode: action.vehicleCode,
          // השתתפות שייכת לרכב: רכב אחר -> לא נושאים את ההשתתפות של הקודם.
          // (רק אם כבר היה רכב קודם שונה; השתתפות שנמסרה לפני שנבחר רכב נשמרת.)
          participation: base?.vehicleCode != null && base.vehicleCode !== action.vehicleCode ? null : (base?.participation ?? null),
          maintenanceAllowance: base?.maintenanceAllowance ?? 0,
        });
        did.currentVehicle = true;
      } else if (action.type === "compare") {
        explicitCompareInPlan = true;
        const spec = { mode: action.mode, ...(action.vehicleCodes ? { vehicleCodes: action.vehicleCodes } : {}), ...(action.includeWaiver !== undefined ? { includeWaiver: action.includeWaiver } : {}) };
        const ok = await runCompare(spec);
        if (ok) {
          // הצלחה -> מנקים בקשה ממתינה (הושלמה).
          await service.setPendingRequest(caseId, ownerId, null).catch(() => {});
        } else {
          // נעצר על מידע חסר -> שומרים את הבקשה כפעילה (עמיד, שורד רענון).
          await service.setPendingRequest(caseId, ownerId, { kind: "compare", ...spec } as PendingReq).catch(() => {});
        }
      } else if (action.type === "search_vehicles") {
        const occupation = occupationOrGroup(facts.occupationCode, facts.reportedGroup);
        // זיהוי לפי שם: מחזיר vehicleCode מאומת או שגיאת עמימות/אי-מציאה — אין ניחוש.
        if (action.name) {
          const nr = await service.lookupVehicleByName(action.name, occupation ?? undefined);
          did.searched = true;
          actionResults.push({ type: "search_vehicles", summary: nr });
        } else if (!occupation) {
          partialFailure = "כדי לחפש לפי זכאות צריך לדעת את קבוצת הזכאות (או העיסוק).";
        } else {
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
          group: facts.reportedGroup ?? "", factsRevision,
        });
        did.inquiry = true;
        actionResults.push({ type: "open_inquiry", summary: { deduped: res.deduped } });
      }
    } catch (err) {
      partialFailure = "לא הצלחתי להשלים את הפעולה כרגע. הנתונים שנשמרו נשמרו; אפשר לנסות שוב.";
      break;
    }
  }

  // דגל: האם הופעלה השוואה אוטומטית (שהמודל לא חזה) שהצליחה - כדי שהתוצאה תנוסח.
  let autoCompared = false;
  // --- המשך אוטומטי של בקשה פעילה שהושלמו לה הנתונים ---
  // אם לא הייתה פעולת compare מפורשת בתוכנית, אבל התעדכנו נתונים (עובדות/רכב),
  // ויש בקשת השוואה ששמורה כפעילה, ואין שינוי כיוון/ביטול -> מריצים אותה פעם אחת.
  const pending = state.case.pendingRequest;
  if (!explicitCompareInPlan && !conflict && !changesDirection && pending && pending.kind === "compare"
      && (did.facts || did.currentVehicle || did.simulation)) {
    const ok = await runCompare({
      mode: pending.mode,
      ...(pending.vehicleCodes ? { vehicleCodes: pending.vehicleCodes } : {}),
      ...(pending.includeWaiver !== undefined ? { includeWaiver: pending.includeWaiver } : {}),
    });
    if (ok) { autoCompared = true; await service.setPendingRequest(caseId, ownerId, null).catch(() => {}); }
    // אם עדיין חסר - הבקשה נשארת פעילה; partialFailure כבר מנוסח עם מה שחסר.
  }
  // שינוי כיוון/ביטול מנקה בקשה פעילה (העובד/ת עברו לנושא אחר).
  if (changesDirection && pending) {
    await service.setPendingRequest(caseId, ownerId, null).catch(() => {});
  }

  // ברירת מחדל: תשובת המודל כפי שהיא (סגנון טבעי). חשוב: חוסר-מידע (partialFailure)
  // אינו דורס את תשובת המודל. השדות החסרים כבר בתמונת-המצב, והמודל אמור לשאול
  // את השאלה הרלוונטית בשפה טבעית - לא להקריא רשימת missingFields. דריסה קורית רק
  // ל-conflict (דיוק "לא נשמר" מונע אי-הבנה) או כשהמודל לא נתן reply שמיש בכלל.
  let reply = object.reply;
  if (conflict) {
    reply = "העובדות השתנו בינתיים ממקור אחר; לא עדכנתי. אפשר לנסות שוב.";
  } else if (partialFailure) {
    // כשל בביצוע (compare נעצר על מידע חסר):
    // - אם המודל ייצר תשובת-ביניים (needsFollowup=true, "בודקת..."), היא מניחה הצלחה שלא הייתה.
    //   במקרה זה נשתמש ב-partialFailure כדי לא להציג הצלחה דמיונית.
    // - אם המודל כבר ייצר שאלה/הודעה ממוקדת (needsFollowup=false), נשמור אותה — היא מדויקת יותר.
    if (!reply || reply.trim() === "" || object.needsFollowup === true) {
      reply = partialFailure;
    }
    // else: keep model reply (it already asks the right question)
  }

  // needsFollowup רק אם יש תוצאה אמיתית לנסח עליה ולא היה כשל חישובי.
  const needsFollowup = (object.needsFollowup === true || autoCompared) && actionResults.length > 0 && !partialFailure;

  return {
    reply,
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