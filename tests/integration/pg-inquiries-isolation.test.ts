// tests/integration/pg-inquiries-isolation.test.ts
// רשימת הבירורים ובידוד בין משתמשים מאומתים (owner_id = מזהה Supabase Auth), מול Postgres אמיתי.
// הכותרת נגזרת מההודעה הראשונה; לעולם לא מתוכן מסמך. ללא מודל.
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { sslFor } from "../../src/server/repositories/pg-ssl.js";
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { findActiveDatasetId } from "../../src/server/services/dataset-provider.js";
import { storePayslip, readPayslipBytes, discardPayslip } from "../../src/server/web/payslip-storage.js";

const APP = process.env.DATABASE_URL;
const run = APP ? describe : describe.skip;
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);

run("בירורים ובידוד בין משתמשים מאומתים", () => {
  let service: CaseService;
  let savedFlag: string | undefined;
  const owners: string[] = [];
  const uid = () => { const id = randomUUID(); owners.push(id); return id; };

  beforeAll(async () => {
    savedFlag = process.env.STRAUSS_ALLOW_FILE_STORE;
    process.env.STRAUSS_ALLOW_FILE_STORE = "1"; // אחסון קבצים מקומי לבדיקה; הבעלות נאכפת ב-RLS
    service = new CaseService(new PgCaseRepository(APP!));
    if (!(await findActiveDatasetId(APP!))) throw new Error("dataset לא יובא");
  }, 30000);

  afterAll(async () => {
    if (savedFlag === undefined) delete process.env.STRAUSS_ALLOW_FILE_STORE; else process.env.STRAUSS_ALLOW_FILE_STORE = savedFlag;
    if (APP) {
      const c = new Client({ connectionString: APP, ...sslFor(APP) });
      await c.connect();
      for (const o of owners) await c.query("delete from cases where owner_id = $1", [o]).catch(() => {});
      await c.end();
    }
  }, 30000);

  async function newCaseWithMessage(owner: string, text: string) {
    const created = await service.startBlankCase(owner);
    await service.appendMessages(created.case.id, owner, [
      { role: "user", clientMessageId: "u-" + randomUUID(), content: [{ type: "text", text }] },
      { role: "assistant", clientMessageId: "a-" + randomUUID(), content: [{ type: "text", text: "תשובה" }] },
    ]);
    return created.case.id;
  }

  it("הרשימה מכילה רק בירורים של המשתמש, עם כותרת מההודעה הראשונה, מהעדכני לישן", { timeout: 60000 }, async () => {
    const a = uid(); const b = uid();
    const a1 = await newCaseWithMessage(a, "אני רוצה לעבור לרכב חשמלי");
    const a2 = await newCaseWithMessage(a, "מה ההפרש בנטו עבור ATTO 3?");
    const b1 = await newCaseWithMessage(b, "בירור סודי של משתמש ב");
    const la = await service.listCaseSummaries(a);
    expect(la.map((x) => x.caseId).sort()).toEqual([a1, a2].sort());
    expect(la[0]!.caseId).toBe(a2); // עודכן אחרון
    expect(la.find((x) => x.caseId === a1)!.title).toBe("אני רוצה לעבור לרכב חשמלי");
    expect(la.find((x) => x.caseId === a1)!.messageCount).toBe(2);
    const lb = await service.listCaseSummaries(b);
    expect(lb.map((x) => x.caseId)).toEqual([b1]);
    // אף כותרת של ב' לא דולפת לרשימה של א'.
    expect(JSON.stringify(la)).not.toContain("סודי");
    // משתמש חדש: רשימה ריקה.
    expect(await service.listCaseSummaries(uid())).toEqual([]);
  });

  it("המשך בירור של אחר: getCaseState מחזיר null (אין הרשאה), גם עם מזהה תקף", { timeout: 40000 }, async () => {
    const a = uid(); const b = uid();
    const aCase = await newCaseWithMessage(a, "פרטי של א'");
    expect(await service.getCaseState(aCase, b)).toBeNull();
    expect(await service.loadMessages(aCase, b)).toEqual([]);
    expect(await service.getCaseState(aCase, a)).not.toBeNull();
  });

  it("כתיבה לבירור של אחר נכשלת (הודעות/עובדות), בלי לשנות את התיק", { timeout: 40000 }, async () => {
    const a = uid(); const b = uid();
    const aCase = await newCaseWithMessage(a, "מקורי");
    await expect(service.appendMessages(aCase, b, [{ role: "user", clientMessageId: "x", content: [{ type: "text", text: "פרצה" }] }])).rejects.toThrow();
    const cur = await service.getCaseState(aCase, a);
    await expect(service.updateFacts(aCase, b, { baseSalary: 1 }, cur!.case.factsRevision)).rejects.toThrow();
    expect((await service.getCaseState(aCase, a))!.facts.baseSalary).toBeNull();
    expect((await service.loadMessages(aCase, a)).length).toBe(2);
  });

  it("מסמכים: משתמש אחר אינו קורא, מוחק או מעלה לתיק של אחר דרך פעולות האפליקציה", { timeout: 60000 }, async () => {
    const a = uid(); const b = uid();
    const aCase = (await service.startBlankCase(a)).case.id;
    const stored = await storePayslip({ connectionString: APP!, ownerId: a, caseId: aCase, bytes: PDF, mime: "application/pdf", originalName: "p.pdf" });
    expect(await readPayslipBytes({ connectionString: APP!, ownerId: b, uploadId: stored.id })).toBeNull();
    await discardPayslip({ connectionString: APP!, ownerId: b, uploadId: stored.id }); // no-op
    expect(await readPayslipBytes({ connectionString: APP!, ownerId: a, uploadId: stored.id })).not.toBeNull();
    await expect(storePayslip({ connectionString: APP!, ownerId: b, caseId: aCase, bytes: PDF, mime: "application/pdf", originalName: null })).rejects.toThrow();
  });

  it("תיק אנונימי ישן (owner_id מסוג demo-…) אינו משויך אוטומטית למשתמש מאומת", { timeout: 40000 }, async () => {
    const legacy = "demo-" + randomUUID();
    owners.push(legacy);
    const legacyCase = (await service.startBlankCase(legacy)).case.id;
    const user = uid();
    expect(await service.listCaseSummaries(user)).toEqual([]);
    expect(await service.getCaseState(legacyCase, user)).toBeNull();
    // והתיק הישן נשאר נגיש רק למזהה הישן (לא נמחק, לא הועבר).
    expect(await service.getCaseState(legacyCase, legacy)).not.toBeNull();
  });
});