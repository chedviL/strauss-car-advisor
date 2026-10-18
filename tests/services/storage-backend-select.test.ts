// tests/services/storage-backend-select.test.ts
// בחירת backend לאחסון התלושים: כשל-הגדרה ברור בפריסה, בלי מעבר שקט לדיסק.
// קובץ נפרד כי הוא משנה משתני-סביבה (process.env) ומשחזר אותם; בידוד זה מונע
// דליפה לבדיקות סבב-האחסון שבוחרות backend לפי הסביבה. ללא מודל, ללא DB.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { activeBackend, StorageConfigError } from "../../src/server/web/payslip-blob.js";
describe("בחירת backend לאחסון: כשל-הגדרה ברור, בלי מעבר שקט לדיסק", () => {
  // שומר/משחזר את משתני הסביבה הרלוונטיים כדי לא לדלוף בין בדיקות.
  const KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "STRAUSS_ALLOW_FILE_STORE", "DATABASE_URL"] as const;
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = {};
    for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("supabase כאשר שני המפתחות מוגדרים", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
    expect(activeBackend()).toBe("supabase");
  });

  it("סביבה פרוסה (DATABASE_URL מוגדר) ללא Supabase ← שגיאת הגדרה, לא local", () => {
    process.env.DATABASE_URL = "postgresql://app@host:6543/db";
    expect(() => activeBackend()).toThrow(StorageConfigError);
  });

  it("אופציה מקומית מפורשת (STRAUSS_ALLOW_FILE_STORE=1) ← local גם עם DATABASE_URL", () => {
    process.env.DATABASE_URL = "postgresql://app@host:6543/db";
    process.env.STRAUSS_ALLOW_FILE_STORE = "1";
    expect(activeBackend()).toBe("local");
  });

  it("הדגל המקומי גובר גם כשמוגדרים מפתחות Supabase", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
    process.env.STRAUSS_ALLOW_FILE_STORE = "1";
    expect(activeBackend()).toBe("local");
  });

  it("פיתוח מקומי טהור (אין DATABASE_URL ואין Supabase) ← local", () => {
    expect(activeBackend()).toBe("local");
  });
});

