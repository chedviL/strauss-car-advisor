// src/app/inquiry-actions.ts
"use server";
// פעולות רשימת הבירורים. הבעלות נבדקת בשרת מול המשתמש המאומת; מזהה תיק מהלקוח
// הוא בקשה בלבד ואינו מעיד על הרשאה (תיק של אחר = לא נמצא, בלי חשיפת קיום).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireOwner } from "../server/auth/next-session.js";
import { caseService } from "../server/web/service.js";

const CASE_COOKIE = "strauss_case";

/** שיחה חדשה: מנקים את מצביע התיק; התיק החדש ייפתח בהודעה הראשונה. */
export async function startNewInquiry(): Promise<void> {
  await requireOwner();
  (await cookies()).delete(CASE_COOKIE);
  redirect("/");
}

/** המשך בירור: מצביע על התיק רק אם הוא בבעלות המשתמש/ת. */
export async function continueInquiry(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const caseId = String(formData.get("caseId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(caseId)) redirect("/inquiries");
  const state = await caseService().getCaseState(caseId, owner);
  if (!state) redirect("/inquiries");
  (await cookies()).set(CASE_COOKIE, state.case.id, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7,
  });
  redirect("/?c=" + state.case.id); // URL מפורש לשחזור ברענון
}