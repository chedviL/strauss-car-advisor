// src/middleware.ts
// רענון סשן Supabase + שער כניסה לכל האפליקציה.
// - בכל בקשה: אימות ה-JWT (מקומי, ES256) ורענון עוגיות כשהטוקן קרוב לפקיעה.
//   Server Components אינם יכולים לכתוב עוגיות, ולכן הרענון נעשה כאן.
// - לא מחובר: עמודים מופנים ל-/login; API מחזיר 401 JSON (בלי הפניה).
// - מחובר ב-/login: מופנה ישירות לבירורים שלו.
// ההרשאה האמיתית נאכפת שוב בכל Route Handler / Server Action / RLS: ה-middleware
// הוא שער נוחות וחוויה, לא מנגנון ההרשאה היחיד.

import { NextResponse, type NextRequest } from "next/server";
import { authConfigured, createAuthClient, type CookieToSet } from "./server/auth/supabase.js";
import { userFromClient } from "./server/auth/claims.js";

// נתיבים ציבוריים ברמת ה-middleware. /api/worker אוכף הרשאה עצמאית (CRON_SECRET)
// ולכן אינו עובר דרך שער הסשן; שאר ה-API דורש סשן מאומת.
const PUBLIC_PATHS = ["/login", "/api/worker", "/api/version"];

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));

  // Auth לא מוגדר בשרת: אין כניסה. לא מאפשרים "דלת פתוחה" כברירת מחדל.
  if (!authConfigured()) {
    if (isPublic) return NextResponse.next();
    if (isApi) return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
    return NextResponse.redirect(new URL("/login", req.url));
  }

  let res = NextResponse.next({ request: req });
  const cacheHeaders: Record<string, string> = {};
  const client = createAuthClient({
    getAll: () => req.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
    setAll: (list: CookieToSet[], headers) => {
      // מעדכנים גם את הבקשה (כדי שה-handler יראה את הסשן המרוענן) וגם את התשובה.
      for (const { name, value } of list) req.cookies.set(name, value);
      res = NextResponse.next({ request: req });
      for (const { name, value, options } of list) res.cookies.set(name, value, options as never);
      Object.assign(cacheHeaders, headers ?? {});
      for (const [k, v] of Object.entries(cacheHeaders)) res.headers.set(k, v);
    },
  });

  const user = await userFromClient(client);

  if (!user && !isPublic) {
    if (isApi) return NextResponse.json({ error: "auth_required" }, { status: 401 });
    const to = NextResponse.redirect(new URL("/login", req.url));
    return to;
  }
  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/inquiries", req.url));
  }
  return res;
}

export const config = {
  // כל הנתיבים חוץ מקבצים סטטיים של Next.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js|map)$).*)"],
};