// src/app/inquiry-actions.ts
"use server";
// פעולות רשימת הבירורים. הבעלות נבדקת בשרת מול המשתמש המאומת; מזהה תיק מהלקוח
// הוא בקשה בלבד ואינו מעיד על הרשאה (תיק של אחר = לא נמצא, בלי חשיפת קיום).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "../server/auth/next-session.js";
import { caseService } from "../server/web/service.js";
import { isUuid } from "../domain/ids.js";

const CASE_COOKIE = "strauss_case";

/** שיחה חדשה: מנקים את מצביע התיק; התיק החדש ייפתח בהודעה הראשונה. */
export async function startNewInquiry(): Promise<void> {
  await requireOwner();
  (await cookies()).delete(CASE_COOKIE);
  redirect("/");
}

/** ניקוי מצביע התיק בלבד, בלי הפניה. הלקוח מבצע אחריו טעינה מלאה של "/" כדי
 *  לאפס גם את מצב ה-chat בצד הלקוח (useChat). */
export async function clearActiveInquiry(): Promise<void> {
  await requireOwner();
  (await cookies()).delete(CASE_COOKIE);
}

/** מחיקת בירור: רק אם בבעלות המשתמש/ת. אם זו השיחה הפעילה - מנקים את המצביע.
 *  לא מפנה לדף אחר (המחיקה מתבצעת "במקום" מהסרגל); revalidate מרענן את הרשימה. */
export async function deleteInquiry(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const caseId = String(formData.get("caseId") ?? "");
  if (!isUuid(caseId)) return;
  const ok = await caseService().deleteCase(caseId, owner);
  if (!ok) return; // לא בבעלות / לא קיים - בלי חשיפה
  const store = await cookies();
  if (store.get(CASE_COOKIE)?.value === caseId) store.delete(CASE_COOKIE);
  // אם נמחקה השיחה הפעילה -> לפתוח מסך נקי; אחרת רק לרענן את הרשימה.
  if (String(formData.get("isActive") ?? "") === "1") redirect("/");
  revalidatePath("/");
}

/** המשך בירור: מצביע על התיק רק אם הוא בבעלות המשתמש/ת. */
export async function continueInquiry(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const caseId = String(formData.get("caseId") ?? "");
  if (!isUuid(caseId)) redirect("/inquiries");
  const state = await caseService().getCaseState(caseId, owner);
  if (!state) redirect("/inquiries");
  (await cookies()).set(CASE_COOKIE, state.case.id, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7,
  });
  redirect("/?c=" + state.case.id); // URL מפורש לשחזור ברענון
}