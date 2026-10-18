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
