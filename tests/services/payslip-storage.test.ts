// tests/services/payslip-storage.test.ts
// אחסון תלוש: ולידציית סוג (חתימת בייטים) + גודל, וסבב שמירה/קריאה מול Postgres
// עם בדיקת בעלות (RLS). ללא מודל. בדיקות הסבב רצות רק כש-DATABASE_URL מוגדר.
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Client } from "pg";
import { sslFor } from "../../src/server/repositories/pg-ssl.js";
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { validatePayslip, storePayslip, readPayslipBytes, discardPayslip, MAX_SIZE_BYTES } from "../../src/server/web/payslip-storage.js";
import { activeBackend, StorageConfigError } from "../../src/server/web/payslip-blob.js";
import type { CaseFacts } from "../../src/domain/contracts/case.js";

// חתימות בייטים
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // MZ (לא נתמך)

describe("ולידציית תלוש (ללא מודל)", () => {
  it("מזהה PDF/JPG/PNG/WEBP לפי חתימת בייטים", () => {
    expect(validatePayslip(PDF)).toEqual({ ok: true, mime: "application/pdf" });
    expect(validatePayslip(JPG)).toEqual({ ok: true, mime: "image/jpeg" });
    expect(validatePayslip(PNG)).toEqual({ ok: true, mime: "image/png" });
    expect(validatePayslip(WEBP)).toEqual({ ok: true, mime: "image/webp" });
  });
  it("דוחה סוג לא נתמך (גם אם הלקוח יטען אחרת)", () => {
    const r = validatePayslip(EXE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("type");
  });
  it("דוחה קובץ ריק", () => {
    const r = validatePayslip(new Uint8Array([]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("empty");
  });
  it("דוחה קובץ גדול מהמותר", () => {
    const big = new Uint8Array(MAX_SIZE_BYTES + 1);
    big.set(PDF, 0);
    const r = validatePayslip(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("size");
  });
});

const CONN = process.env.DATABASE_URL;
const MIG = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const run = CONN ? describe : describe.skip;
const facts: CaseFacts = { occupationCode: "product_manager", reportedGroup: "ג", baseSalary: 18500, commission: 0, bonus: 0, pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.75, qualifyingChildren: 2 };

run("סבב אחסון תלוש מול Postgres (RLS)", () => {
  let repo: PgCaseRepository; let admin: Client; let datasetId: string;
  // בדיקות הסבב משתמשות ב-backend המקומי (local) בכוונה. בסביבת הבדיקה
  // DATABASE_URL מוגדר אך Supabase לא, ולכן נדרשת הסכמה מקומית מפורשת
  // (STRAUSS_ALLOW_FILE_STORE=1) - אחרת activeBackend זורק StorageConfigError
  // (וזה בדיוק ההתנהגות הרצויה בפריסה). שומר/משחזר כדי לא לדלוף.
  let savedAllowFileStore: string | undefined;
  beforeAll(async () => {
    savedAllowFileStore = process.env.STRAUSS_ALLOW_FILE_STORE;
    process.env.STRAUSS_ALLOW_FILE_STORE = "1";
    admin = new Client({ connectionString: MIG!, ...sslFor(MIG!) });
    await admin.connect();
    const rs = await admin.query(`insert into rule_sets (version, content_hash, config) values ('t',$1,'{}'::jsonb) on conflict (content_hash) do update set version=excluded.version returning id`, ["ps-" + randomUUID()]);
    const ds = await admin.query(`insert into datasets (rule_set_id, value_of_use_source, value_of_use_row_count) values ($1,'t',0) returning id`, [rs.rows[0].id]);
    datasetId = ds.rows[0].id;
    repo = new PgCaseRepository(CONN!);
  }, 30000);
  afterAll(async () => { if (savedAllowFileStore === undefined) delete process.env.STRAUSS_ALLOW_FILE_STORE; else process.env.STRAUSS_ALLOW_FILE_STORE = savedAllowFileStore; if (admin) { await admin.query("delete from cases where dataset_id=$1", [datasetId]).catch(() => {}); await admin.end().catch(() => {}); } });

  it("שמירה ואז קריאה מחזירה את אותם בייטים לבעלים", { timeout: 30000 }, async () => {
    const owner = "ps-" + randomUUID();
    const c = await repo.createCase({ ownerId: owner, isDemo: true, datasetId, facts, baseline: { role: "baseline", route: "company_car", vehicleCode: "CAR-09", participation: 300, maintenanceAllowance: 0 } });
    const stored = await storePayslip({ connectionString: CONN!, ownerId: owner, caseId: c.case.id, bytes: PDF, mime: "application/pdf", originalName: "payslip.pdf" });
    expect(stored.mime).toBe("application/pdf");
    const read = await readPayslipBytes({ connectionString: CONN!, ownerId: owner, uploadId: stored.id });
    expect(read).not.toBeNull();
    expect(Array.from(read!.bytes)).toEqual(Array.from(PDF));
  });

  it("בעלים אחר אינו יכול לקרוא את התלוש (RLS)", { timeout: 30000 }, async () => {
    const ownerA = "psA-" + randomUUID();
    const ownerB = "psB-" + randomUUID();
    const c = await repo.createCase({ ownerId: ownerA, isDemo: true, datasetId, facts, baseline: { role: "baseline", route: "company_car", vehicleCode: "CAR-09", participation: 300, maintenanceAllowance: 0 } });
    const stored = await storePayslip({ connectionString: CONN!, ownerId: ownerA, caseId: c.case.id, bytes: JPG, mime: "image/jpeg", originalName: null });
    const asB = await readPayslipBytes({ connectionString: CONN!, ownerId: ownerB, uploadId: stored.id });
    expect(asB).toBeNull(); // RLS חוסם
  });

  it("בעלים אחר אינו יכול למחוק (discard) תלוש של אחר - הקובץ נשאר קריא לבעלים", { timeout: 30000 }, async () => {
    const ownerA = "psDA-" + randomUUID();
    const ownerB = "psDB-" + randomUUID();
    const c = await repo.createCase({ ownerId: ownerA, isDemo: true, datasetId, facts, baseline: { role: "baseline", route: "company_car", vehicleCode: "CAR-09", participation: 300, maintenanceAllowance: 0 } });
    const stored = await storePayslip({ connectionString: CONN!, ownerId: ownerA, caseId: c.case.id, bytes: PDF, mime: "application/pdf", originalName: null });
    // B מנסה למחוק דרך פעולת האפליקציה: RLS חוסם -> אין שורה לעדכן -> לא נמחק blob.
    await discardPayslip({ connectionString: CONN!, ownerId: ownerB, uploadId: stored.id });
    // A עדיין קורא את התלוש (לא נמחק ע"י B).
    const asA = await readPayslipBytes({ connectionString: CONN!, ownerId: ownerA, uploadId: stored.id });
    expect(asA).not.toBeNull();
    expect(Array.from(asA!.bytes)).toEqual(Array.from(PDF));
  });

  it("בעלים אחר אינו יכול להעלות תלוש לתיק של אחר (בדיקת בעלות בהעלאה)", { timeout: 30000 }, async () => {
    const ownerA = "psUA-" + randomUUID();
    const ownerB = "psUB-" + randomUUID();
    const c = await repo.createCase({ ownerId: ownerA, isDemo: true, datasetId, facts, baseline: { role: "baseline", route: "company_car", vehicleCode: "CAR-09", participation: 300, maintenanceAllowance: 0 } });
    await expect(
      storePayslip({ connectionString: CONN!, ownerId: ownerB, caseId: c.case.id, bytes: PDF, mime: "application/pdf", originalName: null }),
    ).rejects.toThrow();
  });
});
