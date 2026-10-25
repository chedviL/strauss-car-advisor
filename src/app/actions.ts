// src/app/actions.ts
"use server";
// Server Actions - משתמשות בשירות האפליקציה. אין חישוב כאן; רק תזמור.
// owner_id = המשתמש המאומת בשרת (סשן Supabase), לעולם לא מהלקוח.

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { caseService } from "../server/web/service.js";
import { requireOwner, requireUser, AuthRequiredError } from "../server/auth/next-session.js";
import { getStaffScope, ForbiddenError, type RepInquiryView } from "../server/auth/staff.js";
import { resolveRepAccess, listForAccess, answerAsRep } from "../server/auth/rep-access.js";
import { repDemoEnabled, isDemoEnrolled, answerAsDemo, enrollDemoAccount, enrollInDemo } from "../server/auth/demo-rep.js";
import { parseRepAnswer, isUuid } from "../server/auth/rep-input.js";
import { validateFactsPatch, InvalidFactsError } from "../server/services/facts-validation.js";
import { sendForInquiryNow } from "../server/notify/worker.js";
import { isSharedDemoAccount } from "../domain/demo-login.js";

export async function startDemoCase(employeeId: string): Promise<void> {
  const owner = await requireOwner();
  const service = caseService();

  // זרימת דמו מלאה בקריאת שירות אחת: יצירה + חלופה + חישוב+שמירה, עם מינימום round-trips.
  const state = await service.startDemoFlow(owner, employeeId);

  // שמירת מזהה התיק הפעיל ב-cookie כדי שרענון ישחזר אותו.
  const { cookies } = await import("next/headers");
  (await cookies()).set("strauss_case", state.case.id, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7,
  });

  revalidatePath("/");
}

/**
 * "המשך בירור קודם": קובע את התיק הפעיל רק אם הוא בבעלות המשתמש/ת המאומת/ת.
 * העוגייה היא מצביע נוחות בלבד - ההרשאה נבדקת כאן ושוב בכל בקשה (RLS לפי בעלות).
 */
export async function openCase(caseId: string): Promise<{ status: "ok" } | { status: "not_found" }> {
  const owner = await requireOwner();
  const state = await caseService().getCaseState(caseId, owner);
  if (!state) return { status: "not_found" };
  const { cookies } = await import("next/headers");
  (await cookies()).set("strauss_case", state.case.id, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7,
  });
  revalidatePath("/");
  return { status: "ok" };
}
export async function resetDemo(): Promise<void> {
  const { cookies } = await import("next/headers");
  (await cookies()).delete("strauss_case");
  revalidatePath("/");
}

/**
 * "שיחה חדשה": מנקה את התיק הפעיל (מוחק את ה-cookie). ההודעה הבאה תפתח תיק ריק
 * חדש אוטומטית (route.startBlankCase). התיק הקודם נשאר במסד להיסטוריה.
 * הלקוח יבצע ניווט מלא אחרי הקריאה כדי לאפס את מצב ה-chat (useChat).
 */
export async function newConversation(): Promise<void> {
  const { cookies } = await import("next/headers");
  (await cookies()).delete("strauss_case");
  revalidatePath("/");
}


/**
 * עדכון "הפרטים שלי" מהטופס. אותו תיק ואותם שירותים כמו השיחה.
 * - שדה שנשלח כ-null -> clear (לא ידוע). שדה עם ערך (כולל 0) -> set מפורש.
 * - שדה שלא נכלל ב-patch אינו משתנה.
 * - אם אין תיק פעיל, נפתח תיק ריק (אותה זרימה כמו ההודעה הראשונה בשיחה).
 * - שמירה בלבד: אין הפעלת מודל ואין חישוב. החישוב מתבצע דרך כפתור נפרד.
 * מחזיר את גרסת העובדות החדשה (או conflict אם הגרסה השתנתה בינתיים).
 */
export async function updateMyFacts(
  patch: Partial<{
    occupationCode: string | null;
    reportedGroup: string | null;
    baseSalary: number | null;
    commission: number | null;
    bonus: number | null;
    pensionRate: number | null;
    trainingRate: number | null;
    creditPoints: number | null;
    qualifyingChildren: number | null;
  }>,
): Promise<{ status: "ok"; factsRevision: number } | { status: "conflict" } | { status: "no_case" } | { status: "invalid"; message: string }> {
  const owner = await requireOwner();
  // Server Action = נקודת קצה ציבורית: מאמתים בזמן ריצה לפני כל יצירת תיק/כתיבה.
  try {
    validateFactsPatch(patch);
  } catch (e) {
    if (e instanceof InvalidFactsError) return { status: "invalid", message: e.message };
    throw e;
  }
  const service = caseService();
  const { cookies } = await import("next/headers");
  const store = await cookies();
  let caseId = store.get("strauss_case")?.value ?? null;

  // אין תיק פעיל -> פותחים תיק ריק (אותה זרימה כמו הודעת השיחה הראשונה).
  let state = caseId ? await service.getCaseState(caseId, owner) : null;
  if (!state) {
    const created = await service.startBlankCase(owner);
    caseId = created.case.id;
    state = created;
    store.set("strauss_case", caseId, {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7,
    });
  }

  const res = await service.updateFacts(caseId!, owner, patch, state.case.factsRevision);
  if (res.status === "conflict") {
    revalidatePath("/");
    return { status: "conflict" };
  }
  revalidatePath("/");
  return { status: "ok", factsRevision: res.factsRevision };
}


/**
 * עזר בדיקה זמני: מילוי נתוני נועה (E-001) מהייחוס המאומת, דרך השירותים הקיימים,
 * ללא קריאת מודל. הנתונים פיקטיביים (isDemo). לא דורס מידע שכבר הוזן בלי אישור:
 * אם קיים שדה-עובדה שכבר מולא ו-force=false, מחזיר needs_confirm עם רשימת השדות.
 * מאפשר לבדוק מיד COROLLA CROSS -> ATTO 3 (11,032 -> 11,693, +661 ₪).
 */
export async function fillSampleData(
  force = false,
): Promise<{ status: "ok" } | { status: "needs_confirm"; existing: string[] } | { status: "error"; message: string }> {
  const owner = await requireOwner();
  const service = caseService();
  const { cookies } = await import("next/headers");
  const store = await cookies();
  let caseId = store.get("strauss_case")?.value ?? null;

  let state = caseId ? await service.getCaseState(caseId, owner) : null;
  if (!state) {
    const created = await service.startBlankCase(owner);
    caseId = created.case.id;
    state = created;
    store.set("strauss_case", caseId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  }

  // הגנה: לא לדרוס מידע קיים בלי אישור מפורש.
  const FACT_LABELS: Record<string, string> = {
    baseSalary: "שכר בסיס", commission: "עמלות", bonus: "בונוס", pensionRate: "פנסיה",
    trainingRate: "קרן השתלמות", creditPoints: "נקודות זיכוי", qualifyingChildren: "ילדים",
    reportedGroup: "קבוצת זכאות", occupationCode: "עיסוק",
  };
  const f = state.facts as unknown as Record<string, unknown>;
  const existing = Object.keys(FACT_LABELS).filter((k) => f[k] !== null && f[k] !== undefined).map((k) => FACT_LABELS[k]!);
  if (existing.length > 0 && !force) {
    return { status: "needs_confirm", existing };
  }

  // נתוני נועה (E-001) מהייחוס המאומת.
  const noa = {
    occupationCode: "product_manager", reportedGroup: "ג", baseSalary: 18500,
    commission: 0, bonus: 0, pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.75, qualifyingChildren: 2,
  };
  try {
    const cur = await service.getCaseState(caseId!, owner); // גרסה עדכנית לבדיקת-גרסה
    const res = await service.updateFacts(caseId!, owner, noa, cur!.case.factsRevision);
    if (res.status === "conflict") return { status: "error", message: "הנתונים השתנו בינתיים; נסה/י שוב." };
    // רכב נוכחי: COROLLA CROSS (CAR-09), השתתפות 300 - כדי שההשוואה ל-ATTO 3 תעבוד.
    await service.updateBaselineVehicle(caseId!, owner, {
      route: "company_car", vehicleCode: "CAR-09", participation: 300, maintenanceAllowance: 0,
    });
    revalidatePath("/");
    return { status: "ok" };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "שגיאה במילוי נתוני הדוגמה" };
  }
}

// ===================== נציג =====================
// ההרשאה נקבעת בשרת בלבד, מהסשן המאומת, ונאכפת שוב ב-SQL (פונקציות SECURITY DEFINER):
//   staff - תפקיד פעיל + היקף ב-staff_roles (נכתב רק בערוץ ניהולי);
//   demo  - התנסות מוגבלת: דגל שרת REP_DEMO_ACCESS_ENABLED + הצטרפות + היקף פניות הבדיקה.
// הלקוח אינו שולח בעלים, תפקיד או מצב גישה. קריאה ישירה לפעולות אלה כעובד רגיל = forbidden.

function dbUrl(): string {
  const c = process.env.DATABASE_URL;
  if (!c || c.trim() === "") throw new Error("DATABASE_URL אינו מוגדר");
  return c;
}

/** האם למשתמש המאומת יש תפקיד נציג ארגוני פעיל (מידע בלבד; השער האמיתי בשרת). */
export async function myStaffScope(): Promise<{ isStaff: boolean }> {
  try {
    const user = await requireUser();
    const scope = await getStaffScope(dbUrl(), user.id);
    return { isStaff: scope !== null };
  } catch {
    return { isStaff: false };
  }
}

export type RepWorkspace =
  | { status: "unauthenticated" }
  | { status: "none"; demoAvailable: boolean }
  | {
      status: "ok";
      mode: "staff" | "demo";
      inquiries: RepInquiryView[];
      vehicleNames: Record<string, string>;
    };

/** טעינת מסך הנציג: מצב הגישה + פניות בהיקף בלבד (הקשר מצומצם, בלי שכר/נטו/מייל/בעלים). */
export async function loadRepWorkspace(): Promise<RepWorkspace> {
  let user;
  try { user = await requireUser(); } catch { return { status: "unauthenticated" }; }
  const conn = dbUrl();
  const access = isSharedDemoAccount(user.email)
    ? (await isDemoEnrolled(conn, user.id) ? { mode: "demo" as const } : { mode: "none" as const, demoAvailable: repDemoEnabled() })
    : await resolveRepAccess(conn, user.id);
  if (access.mode === "none") return { status: "none", demoAvailable: access.demoAvailable };
  const [inquiries, vehicleNames] = await Promise.all([
    listForAccess(conn, user.id, access),
    caseService().vehicleNames(),
  ]);
  return { status: "ok", mode: access.mode, inquiries, vehicleNames };
}

/** רענון הרשימה אחרי מענה. שגיאת הרשאה -> null. */
async function refreshLists(userId: string, sharedDemo = false): Promise<{ inquiries: RepInquiryView[] } | null> {
  try {
    const conn = dbUrl();
    const access = sharedDemo
      ? (await isDemoEnrolled(conn, userId) ? { mode: "demo" as const } : { mode: "none" as const, demoAvailable: false })
      : await resolveRepAccess(conn, userId);
    if (access.mode === "none") return null;
    return { inquiries: await listForAccess(conn, userId, access) };
  } catch {
    return null;
  }
}

/**
 * "התנסות כנציג - להדגמה": מצרף את המשתמש המאומת להתנסות המוגבלת וזורע לו פניות פיקטיביות
 * (אידמפוטנטי). מרגע זה הוא רואה גם את הפניות שלו עצמו וענה עליהן. פעיל רק כשהדגל בשרת
 * מופעל. אינו מעניק הרשאת נציג ארגונית ואינו חושף פניות של אחרים.
 */
export async function startRepDemo(): Promise<{ status: "ok" } | { status: "disabled" } | { status: "error"; message: string }> {
  let user;
  try { user = await requireUser(); } catch { return { status: "disabled" }; }
  if (!repDemoEnabled()) return { status: "disabled" };
  try {
    if (isSharedDemoAccount(user.email)) await enrollDemoAccount(dbUrl(), user.id);
    else await enrollInDemo(caseService(), dbUrl(), user.id);
    revalidatePath("/representative");
    return { status: "ok" };
  } catch (e) {
    if (e instanceof ForbiddenError) return { status: "disabled" };
    console.warn(`[rep-demo] enroll failed: ${e instanceof Error ? e.name : "Error"}`);
    return { status: "error", message: "לא הצלחנו להכין את סביבת ההתנסות. נסו שוב בעוד רגע." };
  }
}

export type RepAnswerResult = (
  | { status: "applied"; recomputed: boolean; missingFields?: string[] }
  | { status: "recorded_not_applied"; reason?: string }
  | { status: "stale_context" }
  | { status: "future_effective"; effectiveFrom: string }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string }
) & { inquiries?: RepInquiryView[] };

/**
 * מענה נציג (רגיל או התנסות) + החלה אם עדיין רלוונטי + חישוב מחדש - הכול בשרת, גם כשהעובדת
 * מנותקת. value ל-employee_participation = השתתפות חודשית (₪); null = חסר, 0 = אפס מפורש.
 * הקלט מאומת כאן (הלקוח אינו מהימן). מחזיר גם את הרשימה המעודכנת, לתצוגת התשובה שנשמרה.
 */
export async function answerRepInquiry(inquiryId: string, answer: unknown): Promise<RepAnswerResult> {
  let user;
  try { user = await requireUser(); } catch { return { status: "forbidden" }; }
  if (!isUuid(inquiryId)) return { status: "not_found" };
  const parsed = parseRepAnswer(answer);
  if (!parsed.ok) return { status: "invalid", message: parsed.message };
  const sharedDemo = isSharedDemoAccount(user.email);
  try {
    const res = sharedDemo
      ? await answerAsDemo(caseService(), dbUrl(), user.id, inquiryId, parsed.answer, { notify: false })
      : await answerAsRep(caseService(), dbUrl(), user.id, inquiryId, parsed.answer);
    revalidatePath("/");
    // משלוח מיידי של ההתראה *אחרי* שהתגובה נשלחה (after של Next.js), כך שהנציג אינו ממתין
    // ל-SMTP. המשימה כבר נשמרה במסד (enqueue), ולכן גם אם ה-after נכשל - המתזמן ישלח בהמשך.
    // בפניות שנזרעו לא נוצרת משימה (sendForInquiryNow מחזיר no_job).
    if (!sharedDemo && res.status !== "not_found" && res.caseId) {
      after(() => sendForInquiryNow(inquiryId).catch((e) => {
        console.warn("[notify] immediate send failed: " + (e instanceof Error ? e.name : "Error"));
      }));
    }
    const lists = await refreshLists(user.id, sharedDemo);
    const extra = lists ? { inquiries: lists.inquiries } : {};
    if (res.status === "applied") {
      return res.missingFields && res.missingFields.length > 0
        ? { status: "applied", recomputed: res.recomputed ?? false, missingFields: res.missingFields, ...extra }
        : { status: "applied", recomputed: res.recomputed ?? false, ...extra };
    }
    if (res.status === "recorded_not_applied") {
      return res.reason ? { status: "recorded_not_applied", reason: res.reason, ...extra } : { status: "recorded_not_applied", ...extra };
    }
    if (res.status === "stale_context") return { status: "stale_context", ...extra };
    if (res.status === "future_effective") return { status: "future_effective", effectiveFrom: res.effectiveFrom ?? "", ...extra };
    return { status: "not_found" };
  } catch (e) {
    if (e instanceof ForbiddenError) return { status: "forbidden" };
    console.warn(`[rep] answer failed: ${e instanceof Error ? e.name : "Error"}`);
    return { status: "error", message: "שגיאה במענה לפנייה. אפשר לנסות שוב; הטופס נשמר." };
  }
}
