// src/app/api/version/route.ts
// נקודת גרסה ציבורית לאימות פריסה: מחזירה את ה-commit SHA ש-Vercel מזריק בזמן
// בנייה (VERCEL_GIT_COMMIT_SHA). ללא סודות - רק מזהה גרסה גלוי. מאפשר לוודא
// שהפריסה הפעילה בכתובת הראשית היא אכן ה-commit הצפוי.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").trim() || "unknown";
  const ref = (process.env.VERCEL_GIT_COMMIT_REF ?? "").trim() || "unknown";
  const v = (process.env.REP_DEMO_ACCESS_ENABLED ?? "").trim().toLowerCase();
  const repDemo = v === "1" || v === "true" || v === "on";
  return new Response(JSON.stringify({ commit: sha, branch: ref, repDemo }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
