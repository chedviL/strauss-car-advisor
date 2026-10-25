// src/server/auth/rep-access.ts
// נקודת הכרעה אחת לגישת נציג: אותם שירותים עסקיים, שני מקורות הרשאה.
//   staff - תפקיד פעיל + היקף ב-staff_roles (נכתב רק בערוץ ניהולי). קודם לכול.
//   demo  - התנסות מוגבלת (דגל שרת + הצטרפות + היקף פניות הבדיקה של המשתמש).
//   none  - אין גישה; demoAvailable אומר אם אפשר להציע התנסות (דגל מופעל).
// הכול נגזר מ-userId של הסשן המאומת. אין כאן תפקיד/בעלות מהלקוח.

import type { CaseService } from "../services/case-service.js";
import { getStaffScope, listRepInquiries, answerAsStaff, ForbiddenError, type RepInquiryView, type RepAnswerOutcome } from "./staff.js";
import { repDemoEnabled, isDemoEnrolled, listDemoInquiries, answerAsDemo } from "./demo-rep.js";

export type RepAccess =
  | { mode: "staff" }
  | { mode: "demo" }
  | { mode: "none"; demoAvailable: boolean };

export async function resolveRepAccess(conn: string, userId: string): Promise<RepAccess> {
  if (await getStaffScope(conn, userId)) return { mode: "staff" };
  if (await isDemoEnrolled(conn, userId)) return { mode: "demo" };
  return { mode: "none", demoAvailable: repDemoEnabled() };
}

/** פניות לפי מצב הגישה. mode=none: ForbiddenError. */
export async function listForAccess(conn: string, userId: string, access: RepAccess): Promise<RepInquiryView[]> {
  if (access.mode === "staff") return await listRepInquiries(conn, userId);
  if (access.mode === "demo") return await listDemoInquiries(conn, userId);
  throw new ForbiddenError("no_access");
}

/** מענה: נציג רגיל אם יש היקף; אחרת התנסות. הרשאה נבדקת מחדש בכל קריאה. */
export async function answerAsRep(
  service: CaseService,
  conn: string,
  userId: string,
  inquiryId: string,
  answer: { value: number | null; note: string | null; effectiveFrom: string | null },
  options?: { today?: string; notify?: boolean },
): Promise<RepAnswerOutcome> {
  if (await getStaffScope(conn, userId)) {
    const staffOptions = options?.today === undefined ? undefined : { today: options.today };
    return await answerAsStaff(service, conn, userId, inquiryId, answer, staffOptions);
  }
  return await answerAsDemo(service, conn, userId, inquiryId, answer, options);
}
