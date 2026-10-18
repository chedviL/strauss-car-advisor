// tests/integration/supabase-storage.test.ts
// אימות backend של Supabase Storage (bucket פרטי "payslips"): סבב
// putBlob -> getBlob -> deleteBlob מול ה-Storage האמיתי, ובידוד נתיב בין בעלים.
// רץ רק כאשר SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY מוגדרים (נטענים מ-.env.local
// ע"י tests/setup/env.ts); אחרת skipped - ואינו נחשב אימות Storage.
// אין כאן מודל ואין עלות; רק I/O מול ה-bucket.

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { putBlob, getBlob, deleteBlob, objectPath, activeBackend } from "../../src/server/web/payslip-blob.js";

const HAS_SUPA = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const run = HAS_SUPA ? describe : describe.skip;

// חתימת PDF מינימלית (בייטים אטומים; התוכן אינו רלוונטי לבדיקת ה-backend).
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25]);

run("Supabase Storage backend (bucket פרטי)", () => {
  it("backend הפעיל הוא supabase כשהמפתחות מוגדרים", () => {
    expect(activeBackend()).toBe("supabase");
  });

  it("סבב putBlob -> getBlob -> deleteBlob מחזיר את אותם בייטים ואז מנקה", { timeout: 40000 }, async () => {
    const owner = "supa-store-" + randomUUID();
    const key = randomUUID() + ".pdf";
    const backend = await putBlob(owner, key, BYTES, "application/pdf");
    expect(backend).toBe("supabase");
    try {
      const got = await getBlob("supabase", owner, key);
      expect(Array.from(new Uint8Array(got))).toEqual(Array.from(BYTES));
    } finally {
      await deleteBlob("supabase", owner, key);
    }
    // אחרי מחיקה - קריאה נכשלת (האובייקט אינו קיים).
    await expect(getBlob("supabase", owner, key)).rejects.toThrow();
  });

  it("בידוד נתיב: נתיב האובייקט של בעלים שונה שונה לחלוטין (hash של owner)", () => {
    const key = "same-key.pdf";
    const pa = objectPath("owner-A", key);
    const pb = objectPath("owner-B", key);
    expect(pa).not.toBe(pb);
    // אותו בעלים + אותו key -> אותו נתיב (דטרמיניסטי), שונה -> שונה.
    expect(objectPath("owner-A", key)).toBe(pa);
  });

  it("קריאה בנתיב של בעלים אחר אינה מחזירה אובייקט שלא הועלה לו", { timeout: 40000 }, async () => {
    const ownerA = "supa-isoA-" + randomUUID();
    const ownerB = "supa-isoB-" + randomUUID();
    const key = randomUUID() + ".pdf";
    await putBlob(ownerA, key, BYTES, "application/pdf");
    try {
      // נתיב B (אותו key, owner אחר) לא קיים -> קריאה נכשלת.
      await expect(getBlob("supabase", ownerB, key)).rejects.toThrow();
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