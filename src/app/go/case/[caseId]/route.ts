// src/app/go/case/[caseId]/route.ts
// שער קישור ההתראה (Route Handler - מורשה להגדיר עוגיות, בניגוד ל-Server
// Component). מחייב התחברות (middleware מפנה ל-/login אם אין סשן), מאמת בעלות על
// התיק, מגדיר את עוגיית מצביע התיק (strauss_case) ומפנה ל-/. תיק שאינו של
// המשתמש/ת -> הפניה ל-/inquiries בלי לחשוף קיום. בעלות נאכפת כאן ושוב ב-RLS.
import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "../../../../server/auth/next-session.js";
import { caseService } from "../../../../server/web/service.js";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await ctx.params;
  const origin = req.nextUrl.origin;
  const to = (path: string) => NextResponse.redirect(new URL(path, origin));

  const user = await getSessionUser();
  if (!user) return to("/login");
  if (!/^[0-9a-f-]{36}$/i.test(caseId)) return to("/inquiries");

  const state = await caseService().getCaseState(caseId, user.id);
  if (!state) return to("/inquiries"); // לא בבעלות / לא קיים - בלי חשיפה

  const res = to("/");
  res.cookies.set("strauss_case", caseId, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
