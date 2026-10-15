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
