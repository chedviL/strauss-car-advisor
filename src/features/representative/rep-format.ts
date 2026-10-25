// src/features/representative/rep-format.ts
// עזרי תצוגה טהורים למסך הנציג (ניתנים לבדיקה בלי React). בלי תלות בשרת.

export type RepType = "employee_participation" | "occupation_eligibility_clarification";

export const DEMO_NOTICE =
  "התנסות בתפקיד נציג — הגישה מוגבלת לפניות הבדיקה שלך ולנתונים פיקטיביים. במערכת ארגונית הגישה מיועדת לנציגים מורשים.";
export const DEMO_ACCOUNT_EMAIL_NOTICE =
  "בהדגמה התשובה זמינה בשיחה. לקבלת התראות במייל ניתן להיכנס באמצעות כתובת אישית.";

export const TYPE_LABEL: Record<RepType, string> = {
  employee_participation: "בירור השתתפות העובד/ת ברכב",
  occupation_eligibility_clarification: "הבהרת זכאות לפי עיסוק",
};

export const ROUTE_LABEL: Record<string, string> = {
  company_car: "רכב חברה",
  family: "מסלול משפחתי",
  waiver: "ויתור על רכב",
};

export const ROLE_LABEL: Record<string, string> = {
  baseline: "הרכב הנוכחי",
  alternative: "החלופה הנבחנת",
};

/** תאריך בפורמט עברי קבוע (אזור זמן קבוע, כדי שרינדור שרת ולקוח יהיו זהים). */
export function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", year: "numeric" });
}

/** "YYYY-MM-DD" -> תאריך עברי (בלי המרת אזור זמן). */
export function formatIsoDay(day: string | null): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const [y, m, d] = day.split("-").map(Number);
  return `${d}.${m}.${y}`;
}

export function formatMoney(n: number | null): string {
  if (n === null) return "לא נקבעה";
  return `${n.toLocaleString("he-IL")} ₪`;
}

export interface SummaryInput {
  type: RepType;
  scenarioRole: "baseline" | "alternative" | null;
  route: "company_car" | "family" | "waiver" | null;
  vehicleCode: string | null;
}

export function vehicleLabel(code: string | null, names: Record<string, string>): string | null {
  if (!code) return null;
  return names[code] ?? code;
}

/** תקציר ענייני של שורה אחת לרשימה: מה נשאל ועל איזה רכב/מסלול. */
export function summarize(q: SummaryInput, names: Record<string, string>): string {
  const parts: string[] = [];
  const role = q.scenarioRole ? ROLE_LABEL[q.scenarioRole] : null;
  const vehicle = vehicleLabel(q.vehicleCode, names);
  if (q.type === "employee_participation") {
    parts.push(role && vehicle ? `${role}: ${vehicle}` : vehicle ?? role ?? "השתתפות חודשית");
  } else {
    parts.push("שאלת זכאות לפי עיסוק וקבוצה");
  }
  if (q.route) parts.push(ROUTE_LABEL[q.route] ?? q.route);
  return parts.join(" · ");
}

/** הבחנה בין ערך חסר לבין אפס מפורש. מחרוזת ריקה = חסר; "0" = אפס. */
export type ParsedValue =
  | { kind: "missing" }
  | { kind: "value"; value: number }
  | { kind: "invalid"; message: string };

export function parseValueInput(raw: string): ParsedValue {
  const t = raw.trim();
  if (t === "") return { kind: "missing" };
  const n = Number(t);
  if (!Number.isFinite(n)) return { kind: "invalid", message: "ערך ההשתתפות אינו מספר תקין." };
  if (n < 0) return { kind: "invalid", message: "ערך ההשתתפות אינו יכול להיות שלילי." };
  return { kind: "value", value: n };
}

export function describeValueInput(p: ParsedValue): string {
  if (p.kind === "missing") return "ללא ערך: תירשם הערה בלבד ולא יוחל שינוי בהשוואה.";
  if (p.kind === "value" && p.value === 0) return "אפס מפורש: ההשתתפות תוגדר ל-0 ₪.";
  if (p.kind === "value") return `ההשתתפות תוגדר ל-${p.value.toLocaleString("he-IL")} ₪.`;
  return p.message;
}

export type Tone = "ok" | "warn" | "err";
export interface ResultMessage { tone: Tone; title: string; detail?: string }

const NOT_APPLIED_REASON: Record<string, string> = {
  no_value: "לא הוזן ערך השתתפות, ולכן נרשמה הערה בלבד.",
  not_participation: "פנייה זו היא הבהרה בלבד (לא ערך להחלה); התשובה נרשמה.",
  no_scenario: "אין תרחיש מקושר בתיק שאפשר להחיל עליו את הערך.",
};

/** מיפוי תוצאת המענה להודעה בעברית. "ההשוואה עודכנה" רק כשחושבה מחדש בפועל. */
export function describeAnswerResult(res: {
  status: string;
  recomputed?: boolean;
  missingFields?: string[];
  reason?: string;
  effectiveFrom?: string;
  message?: string;
}): ResultMessage {
  switch (res.status) {
    case "applied":
      if (res.recomputed) {
        return { tone: "ok", title: "התשובה נשמרה והוחלה, וההשוואה חושבה מחדש.", detail: "העובד/ת יראו את התוצאה המעודכנת בחזרה לבירור." };
      }
      if (res.missingFields && res.missingFields.length > 0) {
        return { tone: "warn", title: "התשובה נשמרה והוחלה, אך ההשוואה לא חושבה מחדש.", detail: `חסרים נתונים בתיק: ${res.missingFields.join(", ")}. החישוב יושלם כשהעובד/ת ישלימו אותם.` };
      }
      return { tone: "warn", title: "התשובה נשמרה והוחלה, אך לא חושבה השוואה מחדש.", detail: "אין כרגע חלופה פעילה בתיק להשוואה." };
    case "stale_context":
      return { tone: "warn", title: "התשובה נשמרה אך לא הוחלה: פרטי התיק השתנו מאז הפנייה.", detail: "כדי להמשיך, העובד/ת יכולים לפתוח בירור מחדש בהקשר העדכני, ואז תתקבל פנייה חדשה." };
    case "future_effective":
      return { tone: "warn", title: `התשובה נשמרה עם תחולה עתידית (${formatIsoDay(res.effectiveFrom ?? "") || res.effectiveFrom}) ולכן עדיין לא הוחלה.`, detail: "להחלה מיידית, עדכנו את התשובה עם תאריך של היום או השאירו את התאריך ריק." };
    case "recorded_not_applied":
      return { tone: "warn", title: "התשובה נשמרה אך לא הוחלה.", detail: NOT_APPLIED_REASON[res.reason ?? ""] ?? "אין תרחיש מקושר להחלה." };
    case "forbidden":
      return { tone: "err", title: "אין הרשאה לענות על פנייה זו.", detail: "ייתכן שהגישה הופסקה. רעננו את הדף." };
    case "not_found":
      return { tone: "err", title: "הפנייה לא נמצאה." };
    case "invalid":
      return { tone: "err", title: res.message ?? "הקלט אינו תקין.", detail: "הטופס נשמר; אפשר לתקן ולשלוח שוב." };
    default:
      return { tone: "err", title: res.message ?? "שגיאה במענה לפנייה.", detail: "הטופס נשמר; אפשר לנסות שוב." };
  }
}
