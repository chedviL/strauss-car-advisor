// tests/integration/pg-payslip-flow.test.ts
// זרימת תלוש מלאה מקצה-לקצה בצד השרת, *ללא קריאת מודל* וללא דפדפן:
//   upload (storePayslip) -> חילוץ מדומה (saveExtraction) -> שחזור חילוץ ממתין
//   (loadPendingExtraction) -> אישור (markApplied + updateFacts) -> בחירת חלופה
//   -> חישוב ושמירת השוואה -> שחזור ממופע שירות חדש (רענון) -> אי-החלה כפולה.
// החילוץ כאן מדומה בכוונה (אובייקט במבנה PayslipExtraction) - אימות הלוגיקה
// והחיווט דרך השירותים הקיימים. חילוץ אמיתי (Gemini) והורדת הקובץ הבינארי
// מ-Supabase (שנחסמה ע"י מסנן-רשת) עדיין ממתינים לאימות נפרד.
//
// רץ רק כאשר DATABASE_URL מוגדר. משתמש ב-backend מקומי לאחסון (STRAUSS_ALLOW_FILE_STORE=1)
// כי הורדת Supabase חסומה בסביבה הנוכחית; הבעלות עדיין נאכפת ב-RLS של המטא-דאטה.

import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { sslFor } from "../../src/server/repositories/pg-ssl.js";
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { findActiveDatasetId } from "../../src/server/services/dataset-provider.js";
import {
  storePayslip, saveExtraction, loadPendingExtraction, markApplied, readPayslipBytes,
} from "../../src/server/web/payslip-storage.js";
import type { PayslipExtraction } from "../../src/server/agent/payslip-extract.js";

const CONN = process.env.DATABASE_URL;
const run = CONN ? describe : describe.skip;

// PDF מינימלי (חתימת %PDF) - בייטים אטומים; התוכן אינו רלוונטי לבדיקת הלוגיקה.
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);

// חילוץ מדומה: מבנה PayslipExtraction כפי שהמודל (Gemini) היה מחזיר - בלי לקרוא לו.
// נועה (E-001): שכר בסיס 18500, פנסיה 6%, קרן השתלמות 2.5%, 2.75 נק' זיכוי.
// commission/bonus לא מופיעים בתלוש -> null (לא אפס). זה המקרה הקשה המתועד.
const SIM_EXTRACTION: PayslipExtraction = {
  baseSalary: { value: 18500, confidence: "high" },
  commission: { value: null, confidence: "low" },
  bonus: { value: null, confidence: "low" },
  pensionRate: { value: 0.06, confidence: "high" },
  trainingRate: { value: 0.025, confidence: "high" },
  creditPoints: { value: 2.75, confidence: "high" },
  notes: "עמלות/בונוס לא הופיעו בתלוש; הוחזרו כ-null.",
};

/** בונה את ה-patch בדיוק כמו הממשק: רק שדות עם value !== null (null לא דורס). */
function buildPatch(ex: PayslipExtraction): Record<string, number> {
  const out: Record<string, number> = {};
  const keys: Array<keyof PayslipExtraction> = ["baseSalary", "commission", "bonus", "pensionRate", "trainingRate", "creditPoints"];
  for (const k of keys) {
    const f = ex[k] as { value: number | null };
    if (f.value !== null) out[k as string] = f.value;
  }
  return out;
}

run("זרימת תלוש מלאה (חילוץ מדומה, ללא מודל) מול Postgres", () => {
  let repo: PgCaseRepository; let service: CaseService;
  let savedFlag: string | undefined;
  const owners: string[] = [];

  beforeAll(async () => {
    savedFlag = process.env.STRAUSS_ALLOW_FILE_STORE;
    process.env.STRAUSS_ALLOW_FILE_STORE = "1"; // אחסון מקומי לבדיקה (הורדת Supabase חסומה)
    repo = new PgCaseRepository(CONN!);
    service = new CaseService(repo);
    const id = await findActiveDatasetId(CONN!);
    if (!id) throw new Error("dataset לא יובא - הרץ npm run import:dataset");
  }, 30000);

  afterAll(async () => {
    if (savedFlag === undefined) delete process.env.STRAUSS_ALLOW_FILE_STORE;
    else process.env.STRAUSS_ALLOW_FILE_STORE = savedFlag;
    if (CONN) {
      const admin = new Client({ connectionString: CONN, ...sslFor(CONN) });
      await admin.connect();
      for (const o of owners) await admin.query("delete from cases where owner_id = $1", [o]).catch(() => {});
      await admin.end();
    }
    if (repo) await repo.close();
  }, 30000);

  it("upload -> חילוץ מדומה -> שחזור ממתין -> אישור -> השוואה -> שחזור -> אי-החלה כפולה", { timeout: 40000 }, async () => {
    const owner = "payslip-flow-" + randomUUID();
    owners.push(owner);

    // תיק ריק (כמו שיחה חדשה). עובדות ריקות בהתחלה.
    const created = await service.startBlankCase(owner);
    const caseId = created.case.id;
    expect(created.facts.baseSalary).toBeNull();

    // 1) upload: שמירת בייטים + שורת מטא-דאטה (RLS).
    const stored = await storePayslip({
      connectionString: CONN!, ownerId: owner, caseId, bytes: PDF, mime: "application/pdf", originalName: "payslip-1.pdf",
    });
    expect(stored.id).toBeTruthy();

    // 2) חילוץ מדומה נשמר על השורה (status=extracted) - כמו שהיה אחרי קריאת מודל.
    await saveExtraction({ connectionString: CONN!, ownerId: owner, uploadId: stored.id, extraction: SIM_EXTRACTION });

    // 3) שחזור אחרי רענון: חילוץ שממתין לאישור משוחזר מהתיק הפעיל.
    const pend = await loadPendingExtraction({ connectionString: CONN!, ownerId: owner, caseId });
    expect(pend).not.toBeNull();
    expect(pend!.uploadId).toBe(stored.id);
    const restoredEx = pend!.extraction as PayslipExtraction;
    expect(restoredEx.baseSalary.value).toBe(18500);
    expect(restoredEx.commission.value).toBeNull(); // null נשמר כ-null (לא אפס)

    // 4) אישור: markApplied אטומי (ראשוני) + updateFacts עם ה-patch (ללא null).
    const first = await markApplied({ connectionString: CONN!, ownerId: owner, uploadId: stored.id });
    expect(first).toBe(true);
    const patch = buildPatch(restoredEx);
    expect("commission" in patch).toBe(false); // null לא נשלח -> לא דורס
    const cur = await service.getCaseState(caseId, owner);
    const upd = await service.updateFacts(caseId, owner, patch, cur!.case.factsRevision);
    expect(upd.status).toBe("ok");

    // העובדות עודכנו מהתלוש.
    const afterApply = await service.getCaseState(caseId, owner);
    expect(afterApply!.facts.baseSalary).toBe(18500);
    expect(afterApply!.facts.pensionRate).toBe(0.06);
    expect(afterApply!.facts.commission).toBeNull(); // נשאר לא-ידוע

    // 5) המשך הבקשה: התלוש לא כלל עמלות/בונוס (null). לפני חישוב, החישוב מדווח
    //    על חוסר - בדיוק ההתנהגות הנכונה (null != 0). בזרימת הממשק השיחה תשאל
    //    על החסר; כאן מדמים אישור מפורש (אין עמלות/בונוס => 0), ואז מחשבים.
    await service.updateFacts(caseId, owner, { reportedGroup: "ג" }, afterApply!.case.factsRevision);
    await service.updateBaselineVehicle(caseId, owner, { route: "company_car", vehicleCode: "CAR-09", participation: 300, maintenanceAllowance: 0 });
    await service.pickAlternative(caseId, owner, { role: "alternative", route: "company_car", vehicleCode: "CAR-10", participation: 300, maintenanceAllowance: 0 });

    // חישוב לפני השלמת החסר -> missing_data (כולל commission/bonus שנשארו null).
    const cmpMissing = await service.computeAndSaveComparison(caseId, owner);
    expect(cmpMissing.status).toBe("missing_data");
    if (cmpMissing.status === "missing_data") {
      expect(cmpMissing.missingFields).toEqual(expect.arrayContaining(["commission", "bonus"]));
    }

    // אישור מפורש של העובד/ת: אין עמלות ואין בונוס (0 מפורש, לא ניחוש).
    const st = await service.getCaseState(caseId, owner);
    await service.updateFacts(caseId, owner, { commission: 0, bonus: 0 }, st!.case.factsRevision);
    const cmp = await service.computeAndSaveComparison(caseId, owner);
    expect(cmp.status).toBe("ok");

    // 6) שחזור אחרי רענון: מופע שירות חדש טוען עובדות + השוואה מ-Postgres.
    const freshRepo = new PgCaseRepository(CONN!);
    const freshService = new CaseService(freshRepo);
    try {
      const restored = await freshService.getCaseState(caseId, owner);
      expect(restored!.facts.baseSalary).toBe(18500);
      expect(restored!.latestComparison).not.toBeNull();
      // החילוץ כבר אינו "ממתין" (status=applied) -> loadPendingExtraction מחזיר null.
      const pend2 = await loadPendingExtraction({ connectionString: CONN!, ownerId: owner, caseId });
      expect(pend2).toBeNull();
    } finally {
      await freshRepo.close();
    }

    // 7) אי-החלה כפולה: markApplied שני מחזיר false (כבר הוחל).
    const second = await markApplied({ connectionString: CONN!, ownerId: owner, uploadId: stored.id });
    expect(second).toBe(false);
  });

  it("בעלות: בעלים אחר אינו קורא את התלוש דרך פעולת האפליקציה (RLS, לא הורדה)", { timeout: 40000 }, async () => {
    const ownerA = "payslip-isoA-" + randomUUID();
    const ownerB = "payslip-isoB-" + randomUUID();
    owners.push(ownerA, ownerB);
    const c = await service.startBlankCase(ownerA);
    const stored = await storePayslip({ connectionString: CONN!, ownerId: ownerA, caseId: c.case.id, bytes: PDF, mime: "application/pdf", originalName: null });
    // B מנסה לקרוא את התלוש של A דרך הפעולה: RLS חוסם לפני כל גישה ל-blob -> null.
    const asB = await readPayslipBytes({ connectionString: CONN!, ownerId: ownerB, uploadId: stored.id });
    expect(asB).toBeNull();
  });
});

describe("סטטוס בדיקת זרימת תלוש", () => {
  it(CONN ? "DATABASE_URL מוגדר - זרימת התלוש (חילוץ מדומה) רצה" : "DATABASE_URL חסר - skipped", () => {
    // תזכורת מתועדת: חילוץ אמיתי (Gemini) והורדת קובץ מ-Supabase עדיין ממתינים לאימות.
    expect(true).toBe(true);
  });
});