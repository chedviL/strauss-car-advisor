// src/features/advisor/vehicle-match/copy.ts
// טקסטי השאלון והמסכים ("איזה רכב מתאים לי?"). האתר פונה בלשון יחיד ("שלך", "לך", "איתך");
// מעדיפים ניסוחים שאינם דורשים הבחנה בין זכר לנקבה.

import type {
  CargoAnswer, ChargingAnswer, PassengerAnswer, PriorityAnswer, QuestionnaireAnswers, SeatsMin, TripsAnswer,
} from "../../../domain/vehicle-match/types.js";

export const FEATURE_NAME = "איזה רכב מתאים לי?";

export const INTRO = {
  title: "יש רכב שמתאים לדרך שלך. נמצא אותו יחד.",
  /** חלוקה למשפטים: כל משפט בלתי־שביר, כדי ששבירת השורה תיפול בין המשפטים. */
  titleParts: ["יש רכב שמתאים לדרך שלך.", "נמצא אותו יחד."],
  lines: ["כמה בחירות קצרות, ונגלה אילו מהרכבים שבזכאות שלך מתאימים לך."],
  cta: "יוצאים לדרך",
  small: "4 שאלות קצרות · אפשר לשנות את הבחירות בכל שלב",
  resumed: "ממשיכים מהמקום שבו עצרת.",
} as const;

export const INVITE = {
  title: "הרכב הבא שלך. בדרך שלך.",
  titleParts: ["הרכב הבא שלך.", "בדרך שלך."],
  body: "כמה שאלות קצרות, ונמצא רכב שמתאים לחיים שלך — מתוך הזכאות שלך.",
  cta: "איזה רכב מתאים לי?",
} as const;

/** מפתחות אייקון (ממופים ל-lucide-react ב-icons.tsx) ותנועת הבחירה החד־פעמית. */
export type IconKey =
  | "solo" | "group" | "bus" | "bag" | "stroller" | "luggage" | "city" | "mixed" | "route"
  | "home" | "plug" | "none" | "unsure" | "wallet" | "package" | "compact" | "balance";
export type ChoiceAnim = "slide" | "drop" | "pop" | "dash" | "tilt";

export interface Choice<T extends string | number> {
  value: T;
  label: string;
  summary: string;
  /** משפט משלים קצר מתחת לכותרת הכרטיס. */
  sub?: string;
  icon?: IconKey;
  anim?: ChoiceAnim;
}

export const PASSENGERS: Array<Choice<PassengerAnswer>> = [
  { value: "one_two", label: "אחד או שניים", summary: "אחד או שניים", icon: "solo", anim: "slide" },
  { value: "three_five", label: "שלושה עד חמישה", summary: "שלושה עד חמישה נוסעים", icon: "group", anim: "slide" },
  { value: "many", label: "שישה ומעלה", summary: "שישה ומעלה", icon: "bus", anim: "slide" },
];
export const SEATS_MIN: Array<Choice<SeatsMin>> = [
  { value: 6, label: "6 נוסעים", summary: "לפחות 6 נוסעים" },
  { value: 7, label: "7 נוסעים", summary: "לפחות 7 נוסעים" },
  { value: 8, label: "8 נוסעים", summary: "לפחות 8 נוסעים" },
];
export const CARGO: Array<Choice<CargoAnswer>> = [
  { value: "bag", label: "תיק וקניות", sub: "השגרה הרגילה", summary: "תיק וקניות", icon: "bag", anim: "drop" },
  { value: "stroller", label: "עגלה וציוד משפחתי", sub: "צריך קצת יותר מקום", summary: "עגלה וציוד משפחתי", icon: "stroller", anim: "drop" },
  { value: "lots", label: "מזוודות והרבה ציוד", sub: "המקום מאחור משמעותי לי", summary: "מזוודות והרבה ציוד", icon: "luggage", anim: "drop" },
];
export const TRIPS: Array<Choice<TripsAnswer>> = [
  { value: "city", label: "בעיקר בעיר", summary: "בעיקר בעיר", icon: "city", anim: "pop" },
  { value: "mixed", label: "קצת מכל דבר", summary: "קצת מכל דבר", icon: "mixed", anim: "tilt" },
  { value: "long", label: "הרבה נסיעות ארוכות", summary: "הרבה נסיעות ארוכות", icon: "route", anim: "dash" },
];
export const CHARGING: Array<Choice<ChargingAnswer>> = [
  { value: "home_work", label: "בבית או בעבודה", summary: "טעינה בבית או בעבודה", icon: "home", anim: "pop" },
  { value: "public", label: "בטעינה ציבורית בלבד", summary: "טעינה ציבורית בלבד", icon: "plug", anim: "pop" },
  { value: "none", label: "אין אפשרות קבועה", summary: "אין אפשרות טעינה קבועה", icon: "none", anim: "pop" },
  { value: "unsure", label: "עדיין לא ברור", summary: "עדיין לא ברור איפה להטעין", icon: "unsure", anim: "tilt" },
];
export const PRIORITY: Array<Choice<PriorityAnswer>> = [
  { value: "net", label: "יותר כסף בנטו", summary: "יותר כסף בנטו", icon: "wallet", anim: "pop" },
  { value: "cargo", label: "יותר מקום לציוד", summary: "יותר מקום לציוד", icon: "package", anim: "drop" },
  { value: "compact", label: "רכב קומפקטי", summary: "רכב קומפקטי", icon: "compact", anim: "pop" },
  { value: "balanced", label: "איזון בין הדברים", summary: "איזון בין הדברים", icon: "balance", anim: "tilt" },
];

export const GROUP_CHOICES: Array<Choice<"א" | "ב" | "ג" | "ד">> = [
  { value: "א", label: "קבוצה א׳", summary: "קבוצה א׳" },
  { value: "ב", label: "קבוצה ב׳", summary: "קבוצה ב׳" },
  { value: "ג", label: "קבוצה ג׳", summary: "קבוצה ג׳" },
  { value: "ד", label: "קבוצה ד׳", summary: "קבוצה ד׳" },
];

export const Q = {
  1: {
    title: "מי מצטרף אליך לדרך?",
    lead: "רק המוזיקה לצידך, או שיש חבורה קבועה במושב האחורי?",
    hint: "כמה נוסעים בדרך כלל, כולל הנהג?",
    sub: "כמה נוסעים לפחות?",
    subHint: "כולל הנהג. זו דרישה הכרחית, לא העדפה: נציג כאן רק רכבים שעומדים בה.",
  },
  2: {
    title: "מה נוסע איתך מאחור?",
    lead: "יש מי שמסתפקים בתיק. ויש מי שהבגאז׳ שלהם הוא חצי בית.",
    hint: "מה צריך לקבל מקום?",
    strollerNote: "נפח מטען עוזר להשוות; התאמה לעגלה מסוימת כדאי לבדוק ברכב.",
  },
  3: {
    title: "לאן החיים לוקחים אותך?",
    lead: "סיבובים בעיר, קילומטרים בכביש הפתוח — או קצת משניהם?",
    hint: "איך נראות הנסיעות שלך בדרך כלל?",
    sub: "ואיפה יש לך אפשרות להטעין?",
    subHint: "העדר טעינה ביתית אינו פוסל רכב חשמלי; נציג שיקולים לגבי שגרת הטעינה.",
  },
  4: {
    title: "מה הכי חשוב לך בבחירה?",
    lead: "עוד כסף בנטו? מקום לכל הציוד? רכב קומפקטי?",
    hint: "אפשר לשנות את הבחירה בכל שלב.",
  },
} as const;

export const RESULTS = {
  title: "נעים להכיר: הכיוונים שלך",
  lead: "אלה הרכבים שבלטו לפי הבחירות שלך. הנה למה הם מתאימים — ומה כדאי לקחת בחשבון.",
  edit: "שינוי העדפות",
  restart: "התחלה מחדש",
  why: "למה הוא מתאים",
  consider: "כדאי לדעת",
  specs: "מפרט",
  specsAndSources: "מפרט ומקורות",
  sources: "מקורות",
  netNeeds: "להשוואת הנטו נשלים כמה פרטים בשיחה.",
  netHeading: "הפרש נטו חודשי",
  assumptions: "ההנחות",
  compareCta: "לבדוק אותו מול הרכב שלי",
  needsCheck: "דורשים בדיקה",
  needsCheckHint: "אלה לא מוצגים כמתאימים בוודאות, כי חסר נתון או שהזכאות טרם נבדקה.",
  finish: "אז מה מתאים לי?",
  next: "המשך",
  prev: "חזרה",
  loading: "מכינים את הכיוונים שלך…",
} as const;

export function answersSummary(a: QuestionnaireAnswers): string[] {
  const out: string[] = [];
  if (a.passengers) {
    out.push(a.passengers === "many" && a.seatsMin
      ? (SEATS_MIN.find((s) => s.value === a.seatsMin)?.summary ?? "")
      : (PASSENGERS.find((p) => p.value === a.passengers)?.summary ?? ""));
  }
  if (a.cargo) out.push(CARGO.find((c) => c.value === a.cargo)?.summary ?? "");
  if (a.trips) out.push(TRIPS.find((c) => c.value === a.trips)?.summary ?? "");
  if (a.charging) out.push(CHARGING.find((c) => c.value === a.charging)?.summary ?? "");
  if (a.priority) out.push(`הכי חשוב: ${PRIORITY.find((c) => c.value === a.priority)?.summary ?? ""}`);
  return out.filter(Boolean);
}
