// src/server/agent/context.ts
// בונה תמונת-מצב קומפקטית ועדכנית למודל בכל תור. מקור האמת לעובדות הוא המסד;
// ההיסטוריה נותנת משמעות שיחתית. אין להעמיס קטלוג מלא; אין להסתמך על סיכום
// חופשי לשמירת מספרים (המספרים כאן מגיעים מה-state שנטען מהמסד).

import type { CaseState, Scenario } from "../../domain/contracts/case.js";
import { findOccupation } from "../../../data/source/occupations.js";
import { isComparisonStale } from "../../domain/calculation/staleness.js";

function money(n: number | null): string {
  return n === null || n === undefined ? "חסר" : `${n} ₪`;
}

function scenarioLine(s: Scenario): string {
  const ovKeys = Object.keys(s.overrides ?? {});
  const sim = ovKeys.length > 0
    ? ` [סימולציה: ${ovKeys.map((k) => `${k}=${(s.overrides as Record<string, number>)[k]}`).join(", ")} — override ברמת התרחיש, לא עובדה אמיתית]`
    : "";
  const part = s.participation === null ? "לא נמסרה (ייתכן ברירת מחדל)" : `${s.participation} ₪`;
  return `  - [${s.id}] ${s.role === "baseline" ? "מצב נוכחי" : "חלופה"}: מסלול=${s.route}` +
    ` רכב=${s.vehicleCode ?? "—"} השתתפות=${part} אחזקה=${money(s.maintenanceAllowance)} (גרסה ${s.revision})${sim}`;
}

/**
 * תמונת מצב קומפקטית. מחזירה טקסט מובנה שמוזרק ל-system בכל תור.
 * כולל: עובדות+מקור+חוסרים, מצב+חלופות עם מזהים, מה סימולציה, עדכניות ההשוואה,
 * פניות ותשובות נציג, ומטרת/העדפות העובד/ת כפי שנמסרו (עובדות בלבד).
 */
export function buildContext(state: CaseState): string {
  const f = state.facts;
  const occ = findOccupation(f.occupationCode);

  // עובדות + חוסרים
  const missing: string[] = [];
  const factPairs: Array<[string, number | string | null]> = [
    ["שכר בסיס", f.baseSalary], ["עמלות", f.commission], ["בונוס", f.bonus],
    ["שיעור פנסיה", f.pensionRate], ["שיעור קה\"ש", f.trainingRate],
    ["נקודות זיכוי", f.creditPoints], ["ילדים מזכים", f.qualifyingChildren],
  ];
  for (const [name, v] of factPairs) if (v === null || v === undefined) missing.push(name);
  if (!f.occupationCode) missing.push("עיסוק");
  if (!f.reportedGroup) missing.push("קבוצת זכאות");

  // זכאות ידועה/לא ידועה
  let eligLine: string;
  if (!occ) {
    eligLine = "זכאות: לא ידועה (עיסוק לא מזוהה) — אין לקבוע 'לא זכאי', אלא לבקש/להבהיר עיסוק.";
  } else {
    eligLine = `זכאות (לפי עיסוק ${occ.name}): קבוצה=${occ.group}, רכב חובה=${occ.carMandatory ? "כן" : "לא"},` +
      ` ויתור מותר=${occ.waiverAllowed ? "כן" : "לא"}${occ.waiverAllowed ? `, אחזקה בוויתור=${occ.maintenanceAllowance} ₪` : ""}.`;
  }

  // עדכניות ההשוואה: תקפה אם facts_revision תואם ו(ב-baseline/alt) revisions לא השתנו מאז.
  const cmp = state.latestComparison;
  let cmpLine: string;
  if (!cmp) {
    cmpLine = "השוואה אחרונה: אין. (חישוב מתבצע כשמבקשים וכשיש קלט.)";
  } else {
    const stale = isComparisonStale(state);
    cmpLine = `השוואה אחרונה (${cmp.completedAt.slice(0, 16).replace("T", " ")}): דלתא-נטו=${cmp.result.netDeltaDisplay} ₪` +
      ` [נבנתה על גרסת-עובדות ${cmp.factsRevision}; הגרסה הנוכחית ${state.case.factsRevision}].` +
      (stale ? " ⚠️ מיושנת — העובדות השתנו מאז; יש לחשב מחדש לפני הצגה כעדכנית." : " עדכנית.");
  }

  // פניות ותשובות
  const inqLines = state.openInquiries.map((q) => {
    if (q.status === "answered") {
      const val = q.answerValue !== null ? `${q.answerValue} ₪` : "(ללא ערך מספרי)";
      const eff = q.effectiveFrom ? ` מתחולה ${q.effectiveFrom}` : "";
      const note = q.answerNote ? ` — ${q.answerNote}` : "";
      return `  - [${q.id}] ${q.type}: נענתה ✓ ערך=${val}${eff}${note}. יש לשקול חישוב מחדש אם רלוונטי.`;
    }
    return `  - [${q.id}] ${q.type}: ממתינה לתשובת נציג. אפשר להמשיך בבירורים אחרים בינתיים.`;
  });

  // סטטוס זרימת התלוש - כדי שהמודל יידע אם הנתונים כבר אושרו/הוחלו, בלי לקבל
  // את המסמך עצמו שוב. אחרי apply אסור לומר 'לא הגיע תלוש'; לפני apply החילוץ
  // אינו עובדות מאושרות.
  const ps = state.payslipStatus;
  const payslipLine =
    ps === "applied" ? "תלוש: הועלה, חולץ, ואושר/הוחל. העובדות שלמעלה כוללות את נתוני התלוש. אל תאמר/י שלא הגיע תלוש."
    : ps === "extracted" ? "תלוש: הועלה וחולץ, אך *טרם אושר*. אל תתייחס/י לחילוץ כעובדות מאושרות עד שהמשתמש/ת מאשר/ת (הערכים מוצגים לאישור/עריכה בממשק)."
    : ps === "uploaded" ? "תלוש: הועלה וממתין לחילוץ. אל תתייחס/י אליו כאל עובדות עדיין."
    : "תלוש: לא הועלה.";
  // בקשת השוואה שנעצרה על חוסר-נתונים (עמידה, שורדת רענון) - יש להשלים ולהמשיך.
  const pend = state.case.pendingRequest;
  const pendLine = pend && pend.kind === "compare"
    ? `בקשה ממתינה: השוואה (${pend.mode}${pend.vehicleCodes && pend.vehicleCodes.length ? ": " + pend.vehicleCodes.join(", ") : ""}) נעצרה על חוסר-נתונים. כשיש נתונים מאושרים - השלם/י את ההשוואה והצג/י כרטיס, בלי לבקש מהמשתמש/ת להתחיל מחדש.`
    : "אין בקשה ממתינה.";

  const lines = [
    `# תמונת מצב התיק (מקור אמת: המסד; גרסת עובדות ${state.case.factsRevision})`,
    `## עובדות מאושרות`,
    `  עיסוק=${f.occupationCode ?? "חסר"} | קבוצה מדווחת=${f.reportedGroup ?? "חסר"}`,
    `  שכר=${money(f.baseSalary)} עמלות=${money(f.commission)} בונוס=${money(f.bonus)}`,
    `  פנסיה=${f.pensionRate ?? "חסר"} קה"ש=${f.trainingRate ?? "חסר"} נק'זיכוי=${f.creditPoints ?? "חסר"} ילדים=${f.qualifyingChildren ?? "חסר"}`,
    missing.length > 0 ? `  שדות שעדיין לא נמסרו (נדרשים רק כשמחשבים נטו, לא רשימת שאלות חובה): ${missing.join(", ")}` : `  כל העובדות הדרושות לחישוב קיימות.`,
    eligLine,
    `## מצב וחלופות (מזהים לשימוש בכלים)`,
    ...(state.scenarios.length > 0 ? state.scenarios.map(scenarioLine) : ["  (אין תרחישים)"]),
    `## השוואה`,
    cmpLine,
    `## פניות לנציג`,
    ...(inqLines.length > 0 ? inqLines : ["  אין פניות."]),
    `## תלוש ובקשה ממתינה`,
    `  ${payslipLine}`,
    `  ${pendLine}`,
  ];
  return lines.join("\n");
}