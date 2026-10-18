/** @type {import('next').NextConfig} */

// כותרות אבטחה בסיסיות (AC-8.4.3). CSP שמרני: משאבים מאותו מקור בלבד.
// inline styles מותרים (האפליקציה משתמשת ב-style props רבים); אין HTML גולמי
// מהמודל. קריאות לספקים חיצוניים (Anthropic/Google/Supabase) מתבצעות בצד שרת,
// ולכן connect-src 'self' מספיק לדפדפן (ה-streaming הוא מול /api באותו מקור).
// מצב dev של Next (React Refresh/HMR) דורש eval; בפרודקשן אין צורך ולכן נשאר מחמיר.
const isDev = process.env.NODE_ENV !== "production";
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  scriptSrc,
  isDev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
  "font-src 'self' data:",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig = {
  reactStrictMode: true,
  // אריזת קובץ הכללים (strauss-rules.json) לתוך פונקציות השרת ב-Vercel. הקובץ
  // נקרא בזמן ריצה דרך נתיב מחושב (fileURLToPath) ש-Next אינו עוקב אחריו
  // אוטומטית; בלי זה מתקבל ENOENT בפריסה. הקובץ קטן ומחויב ב-Git.
  outputFileTracingIncludes: {
    "/**": ["./data/source/strauss-rules.json"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  webpack: (config) => {
    // מאפשר ייבוא עם סיומת .js שתיפתר ל-.ts/.tsx (ESM NodeNext style),
    // כדי לשמור על ייבוא עקבי בין vitest (NodeNext) ל-Next.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;