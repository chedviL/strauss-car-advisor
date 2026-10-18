// src/app/actions.ts
"use server";
// Server Actions - משתמשות בשירות האפליקציה. אין חישוב כאן; רק תזמור.
// owner_id מוזרק מהשרת (cookie), לעולם לא מהלקוח.

import { revalidatePath } from "next/cache";
import { caseService } from "../server/web/service.js";
import { getOrCreateVisitOwner } from "../server/web/visit.js";

export async function startDemoCase(employeeId: string): Promise<void> {
  const owner = await getOrCreateVisitOwner();
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
): Promise<{ status: "ok"; factsRevision: number } | { status: "conflict" } | { status: "no_case" }> {
  const owner = await getOrCreateVisitOwner();
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
  const owner = await getOrCreateVisitOwner();
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
