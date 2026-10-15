// src/server/agent/fast-path.ts
// חתך ניסוי (דגל CHAT_FAST_PATH): מסלול קריאת-מודל-אחת להודעות איסוף/תיקון/
// סימולציה פשוטות. המודל מחזיר פלט מובנה (עדכונים מוצעים + תשובה/שאלת המשך),
// הקוד מאמת ושומר דרך חוזי השירות הקיימים, ומציג אישור רק אחרי שמירה מוצלחת.
// אם המודל מסמן needsTools -> נופלים חזרה ללולאת הכלים המלאה (ללא קריאת סיווג נפרדת).

import { generateObject } from "ai";
import { z } from "zod";
import type { CaseService } from "../services/case-service.js";
import type { CaseState } from "../../domain/contracts/case.js";
import type { FactsPatch } from "../repositories/case-repository.js";
import { getModel, getEffort } from "./model.js";
import { buildContext } from "./context.js";

// פלט מובנה מהמסלול המהיר.
const fastSchema = z.object({
  // האם הבקשה דורשת תוצאה חיצונית (חיפוש/השוואה/פנייה) -> לנפול ללולאת הכלים.
  needsTools: z.boolean(),
  // עדכוני עובדות אמיתיים מוצעים (תיקון/איסוף). שדות מרשימה סגורה.
  factUpdates: z
    .object({
      baseSalary: z.number().nonnegative().optional(),
      commission: z.number().nonnegative().optional(),
      bonus: z.number().nonnegative().optional(),
      pensionRate: z.number().min(0).max(1).optional(),
      trainingRate: z.number().min(0).max(1).optional(),
      creditPoints: z.number().min(0).max(20).optional(),
      qualifyingChildren: z.number().int().min(0).max(20).optional(),
      occupationCode: z.string().optional(),
      reportedGroup: z.enum(["א", "ב", "ג", "ד"]).optional(),
    })
    .optional(),
  // שינוי היפותטי (סימולציה) ברמת התרחיש - שדות שכר בלבד.
  simulationSalaryOverride: z
    .object({
      baseSalary: z.number().nonnegative().optional(),
      commission: z.number().nonnegative().optional(),
      bonus: z.number().nonnegative().optional(),
    })
    .optional(),
  // תשובה שיחתית טבעית (בלי לטעון שבוצעה פעולה - האישור יתווסף אחרי שמירה).
  reply: z.string(),
});

export type FastPathResult =
  | { kind: "handled"; reply: string; updatedFacts: boolean; simulation: boolean; conflict: boolean }
  // needsTools: ממשיכים למסלול המלא, אבל עדכוני העובדות כבר הוחלו כאן (לא מאבדים
  // ולא מבצעים פעמיים). conflict=true אם בדיקת הגרסה נכשלה (אז לא הוחל כלום).
  | { kind: "needs_tools"; appliedFactUpdates: boolean; conflict: boolean };

const FAST_SYSTEM = `את/ה היועץ/ת של שטראוס. זהו מסלול מהיר לטיפול בהודעות פשוטות של
איסוף/תיקון עובדות או סימולציה היפותטית. החזר/י פלט מובנה:

- needsTools=true אם הבקשה דורשת תוצאה חיצונית (חיפוש רכבים, השוואת נטו, פנייה לנציג,
  שליפת פירוט). חשוב: גם כאשר needsTools=true, מלא/י factUpdates אם ההודעה כוללת גם
  תיקון/עדכון עובדה (למשל "תקני את השכר ל-19,000 ותשווי חשמליים") - העדכון יישמר כאן
  לפני החישוב, לא יאבד ולא יבוצע פעמיים.
- factUpdates: עדכון עובדות אמיתיות שהעובד/ת מסר/ה או תיקן/ה (למשל "השכר שלי 18,500").
  כסף בשקלים; שיעורים כשבר (0.06=6%). רק שדות שנמסרו במפורש.
- simulationSalaryOverride: שינוי היפותטי ("מה אם השכר יעלה ל-X") - שכר בלבד, לא עובדה אמיתית.
- reply: תשובה טבעית וקצרה בעברית. אל תטען/י שהעדכון נשמר - המערכת תאשר אחרי השמירה.
  לברכה פשוטה: החזר/י needsTools=false, בלי עדכונים, עם תשובה חמה קצרה.

הבחן/י: עובדה/תיקון -> factUpdates. "מה אם" -> simulationSalaryOverride. בקשת חישוב/חיפוש -> needsTools=true.`;

export async function tryFastPath(
  service: CaseService,
  caseId: string,
  ownerId: string,
  state: CaseState,
  userText: string,
): Promise<FastPathResult> {
  const { object } = await generateObject({
    model: getModel(),
    schema: fastSchema,
    system: FAST_SYSTEM + "\n\n" + buildContext(state),
    prompt: userText,
    maxOutputTokens: 800,
    providerOptions: { anthropic: { effort: getEffort() } },
  });

  // עדכוני עובדות מוחלים תמיד (גם כש-needsTools), כדי שבקשה משולבת
  // ("תקני שכר ל-19,000 ותשווי חשמליים") תשמור את התיקון לפני החישוב - ללא
  // אובדן וללא ביצוע כפול במסלול המלא.
  let updatedFacts = false;
  let simulation = false;
  let conflict = false;
  const notes: string[] = [];

  if (object.factUpdates && Object.keys(object.factUpdates).length > 0) {
    const patch: FactsPatch = {};
    for (const [k, v] of Object.entries(object.factUpdates)) {
      if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
    }
    const res = await service.updateFacts(caseId, ownerId, patch, state.case.factsRevision);
    if (res.status === "conflict") {
      conflict = true;
      notes.push("העובדות עודכנו בינתיים ממקור אחר; לא שמרתי. נטען מצב עדכני וננסה שוב.");
    } else {
      updatedFacts = true;
    }
  }

  // דורש כלים: עדכוני העובדות כבר הוחלו כאן; המסלול המלא ימשיך רק את עבודת הכלים.
  if (object.needsTools) {
    return { kind: "needs_tools", appliedFactUpdates: updatedFacts, conflict };
  }

  // סימולציה היפותטית - override ברמת התרחיש (לא משנה עובדה אמיתית).
  if (!conflict && object.simulationSalaryOverride && Object.keys(object.simulationSalaryOverride).length > 0) {
    const alt = state.scenarios.find((s) => s.role === "alternative");
    const overrides: Record<string, number> = {};
    for (const [k, v] of Object.entries(object.simulationSalaryOverride)) {
      if (v !== undefined) overrides[k] = v;
    }
    await service.pickAlternative(caseId, ownerId, {
      role: "alternative",
      route: alt?.route ?? "company_car",
      vehicleCode: alt?.vehicleCode ?? null,
      participation: alt?.participation ?? null,
      maintenanceAllowance: alt?.maintenanceAllowance ?? 0,
      overrides,
    });
    simulation = true;
  }

  // האישור הכספי/עובדתי מתווסף רק אחרי שמירה מוצלחת.
  let reply = object.reply;
  if (conflict) reply = notes.join(" ");
  else {
    const confirm: string[] = [];
    if (updatedFacts) confirm.push("עדכנתי את הפרטים.");
    if (simulation) confirm.push("שמרתי את התרחיש ההיפותטי (לא שינה את הנתונים האמיתיים).");
    if (confirm.length > 0) reply = confirm.join(" ") + " " + reply;
  }

  return { kind: "handled", reply, updatedFacts, simulation, conflict };
}