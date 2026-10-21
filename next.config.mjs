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
  // media-src אינו יורש מ-img-src; נדרש blob: כדי שהקלטת הדיבור (MediaRecorder)
  // תהיה ניתנת להשמעה/טיפול בדפדפן לפני השליחה לתמלול.
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  scriptSrc,
  isDev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
  "font-src 'self' data: https://fonts.gstatic.com",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // microphone=(self): נדרש לקלט דיבור בקומפוזר (הקלטה -> תמלול בצד שרת).
  // ההרשאה מוגבלת למקור שלנו בלבד (לא ל-iframes/צד שלישי), והדפדפן עדיין
  // מבקש אישור מפורש מהמשתמש/ת. מצלמה ומיקום נשארים חסומים לחלוטין.
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
];

const nextConfig = {
  reactStrictMode: true,
  // אריזת קובץ הכללים (strauss-rules.json) לתוך פונקציות השרת ב-Vercel. הקובץ
  // נקרא בזמן ריצה דרך נתיב מחושב (fileURLToPath) ש-Next אינו עוקב אחריו
  // אוטומטית; בלי זה מתקבל ENOENT בפריסה. הקובץ קטן ומחויב ב-Git.
  outputFileTracingIncludes: {
    "/**": ["./data/source/strauss-rules.json"],
    // ה-PDF של ההשוואה קורא פונטים ולוגו מהדיסק בזמן ריצה (נתיב מחושב ש-Next אינו
    // עוקב אחריו אוטומטית) - בלי זה מתקבל ENOENT בפריסה, כמו עם קובץ הכללים.
    "/api/comparison-pdf": ["./assets/fonts/*.ttf", "./assets/brand/strauss-logo-pdf.png"],
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