// tests/setup/env.ts - נטען לפני כל קובץ בדיקה; טוען .env.local בלי להדפיס סודות.
import { loadEnv } from "../../src/server/web/load-env.js";
loadEnv();