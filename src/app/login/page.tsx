// src/app/login/page.tsx
// מסך כניסה: מייל -> קוד חד-פעמי -> היועץ. ללא סיסמה, ללא הרשמה נפרדת, ללא כניסת הדגמה.
// קומפוזיציה חזותית (feat/login-visual): אזור איור רכב-רשת משמאל, טופס כניסה מימין,
// רקע פנינה בהיר. האיור והתנועה דקורטיביים בלבד; הכניסה זמינה גם בלעדיהם.
// רכיב שרת דק: מחשב configured ומעביר ל-LoginExperience (client) שמרכיב
// את שכבת האיור ואת הטופס.
import { LoginExperience } from "../../features/auth/LoginExperience.js";
import { authConfigured } from "../../server/auth/supabase.js";

export default function LoginPage() {
  return <LoginExperience configured={authConfigured()} />;
}
