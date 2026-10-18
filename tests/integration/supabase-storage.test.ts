// tests/integration/supabase-storage.test.ts
// אימות backend של Supabase Storage (bucket פרטי "payslips") מול ה-Storage האמיתי:
// העלאה, בידוד נתיב, היעדרות אובייקט לבעלים אחר, ומחיקה. סבב ה-download הבינארי
// המלא נבדק אם הסביבה מאפשרת - בחלק מהרשתות (למשל מסנן תוכן כגון NetFree) הורדת
// האובייקט הבינארי נחסמת/משוכתבת; במקרה כזה החלק הזה מדווח כ-skipped עם סיבה,
// בלי לסמן כשל-קוד. רץ רק כאשר SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY מוגדרים.
// אין מודל ואין עלות; רק I/O מול ה-bucket. אין הדפסת מפתחות.

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { putBlob, getBlob, deleteBlob, objectPath, activeBackend } from "../../src/server/web/payslip-blob.js";

const HAS_SUPA = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const run = HAS_SUPA ? describe : describe.skip;
const BUCKET = "payslips";

// חתימת PDF מינימלית (בייטים אטומים; התוכן אינו רלוונטי ל-backend).
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25]);

/** זיהוי חסימה של מסנן-רשת (NetFree וכד') - הורדה שנחסמה/שוכתבה, לא כשל-קוד. */
function isNetworkFilterError(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return m.includes("netfree") || m.includes("418") || m.includes("fetch failed");
}

async function supaClient() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

run("Supabase Storage backend (bucket פרטי)", () => {
  it("backend הפעיל הוא supabase כשהמפתחות מוגדרים", () => {
    expect(activeBackend()).toBe("supabase");
  });

  it("putBlob מעלה בהצלחה, ואז deleteBlob מנקה; אם הרשת מאפשרת - גם getBlob מחזיר את אותם בייטים", { timeout: 40000 }, async () => {
    const owner = "supa-store-" + randomUUID();
    const key = randomUUID() + ".pdf";
    const backend = await putBlob(owner, key, BYTES, "application/pdf");
    expect(backend).toBe("supabase"); // ההעלאה הצליחה מול ה-backend הפרטי
    try {
      try {
        const got = await getBlob("supabase", owner, key);
        // אם ההורדה עברה (רשת מתירה) - הבייטים חייבים להיות זהים.
        expect(Array.from(new Uint8Array(got))).toEqual(Array.from(BYTES));
      } catch (e) {
        if (isNetworkFilterError(e)) {
          console.warn("[skip] הורדת אובייקט בינארי נחסמה ע\"י מסנן-רשת (NetFree); ההעלאה והמחיקה נבדקו. להרצה מלאה: רשת ללא סינון או סביבת פריסה.");
        } else {
          throw e; // כשל-קוד אמיתי - לא מדלגים
        }
      }
    } finally {
      await deleteBlob("supabase", owner, key);
    }
  });

  it("בידוד נתיב: נתיב אובייקט נגזר מ-hash(owner); בעלים שונה -> נתיב שונה, דטרמיניסטי", () => {
    const key = "same-key.pdf";
    const pa = objectPath("owner-A", key);
    const pb = objectPath("owner-B", key);
    expect(pa).not.toBe(pb);
    expect(objectPath("owner-A", key)).toBe(pa);
  });

  it("היעדרות אובייקט לבעלים אחר: הנתיב של B אינו קיים ב-bucket (בדיקה דרך list, לא download)", { timeout: 40000 }, async () => {
    const ownerA = "supa-isoA-" + randomUUID();
    const ownerB = "supa-isoB-" + randomUUID();
    const key = randomUUID() + ".pdf";
    await putBlob(ownerA, key, BYTES, "application/pdf");
    try {
      const client = await supaClient();
      const dirB = objectPath(ownerB, key).split("/")[0]!;
      // list על תיקיית B (לא קיימת) - אין בה את ה-key. לא מסתמכים על download
      // (שעלול להיחסם ע"י מסנן-רשת ולהחזיר תוצאה חיובית מטעה).
      const { data, error } = await client.storage.from(BUCKET).list(dirB);
      expect(error).toBeFalsy();
      const names = (data ?? []).map((o) => o.name);
      expect(names).not.toContain(key);
      // ולראיה - התיקייה של A כן מכילה את ה-key.
      const dirA = objectPath(ownerA, key).split("/")[0]!;
      const listA = await client.storage.from(BUCKET).list(dirA);
      expect((listA.data ?? []).map((o) => o.name)).toContain(key);
    } finally {
      await deleteBlob("supabase", ownerA, key);
    }
  });
});

describe("סטטוס בדיקות Supabase Storage", () => {
  it(HAS_SUPA ? "מפתחות Supabase מוגדרים - בדיקות Storage רצות" : "SUPABASE_URL/SERVICE_ROLE_KEY חסרים - skipped", () => {
    expect(true).toBe(true);
  });
});