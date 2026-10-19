// src/app/go/case/[caseId]/page.tsx
// שער קישור ההתראה: מחייב התחברות (middleware מפנה ל-/login אם אין סשן), ואז
// מאמת בעלות על התיק לפני פתיחתו. תיק שאינו של המשתמש/ת -> חזרה לרשימת הבירורים
// (בלי לחשוף קיום). בעלות נאכפת כאן ושוב ב-RLS.
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSessionUser } from "../../../../server/auth/next-session.js";
import { caseService } from "../../../../server/web/service.js";

export const dynamic = "force-dynamic";

export default async function GoToCase({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!/^[0-9a-f-]{36}$/i.test(caseId)) redirect("/inquiries");

  const state = await caseService().getCaseState(caseId, user.id);
  if (!state) redirect("/inquiries"); // לא בבעלות / לא קיים - בלי חשיפה

  (await cookies()).set("strauss_case", caseId, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7,
  });
  redirect("/");
}