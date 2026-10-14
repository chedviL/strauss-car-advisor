// src/app/actions.ts
"use server";
// Server Actions - משתמשות בשירות האפליקציה. אין חישוב כאן; רק תזמור.
// owner_id מוזרק מהשרת (cookie), לעולם לא מהלקוח.

import { revalidatePath } from "next/cache";
import { caseService } from "../server/web/service.js";
import { getOrCreateVisitOwner } from "../server/web/visit.js";
import { SAMPLE_EMPLOYEES } from "../../data/source/sample-employees.js";

export async function startDemoCase(employeeId: string): Promise<void> {
  const owner = await getOrCreateVisitOwner();
  const service = caseService();
  const emp = SAMPLE_EMPLOYEES.find((e) => e.id === employeeId);
  if (!emp) throw new Error("עובד לדוגמה לא נמצא");

  const state = await service.createDemoCaseFromEmployee(owner, employeeId);

  // חתך ראשון: מיישמים את החלופה המוצעת ומחשבים מיד, כדי להציג כרטיס מלא.
  await service.pickAlternative(state.case.id, owner, {
    role: "alternative",
    route: emp.suggestedAlternative.route,
    vehicleCode: emp.suggestedAlternative.vehicleCode,
    participation: emp.suggestedAlternative.participation,
    maintenanceAllowance: emp.suggestedAlternative.maintenanceAllowance,
  });
  await service.computeAndSaveComparison(state.case.id, owner);

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