// tests/integration/pg-staff-authz.test.ts
// הרשאות נציג מול Postgres אמיתי (RLS + SECURITY DEFINER). ללא מודל.
// מוכיח: deny-by-default; עובד רגיל אינו רואה ואינו עונה, גם בקריאה ישירה למזהה תקף;
// היקף סוגי פניות; ביטול תפקיד; אי-חשיפת קיום; audit; ושהנציג לא רואה שכר/מייל.
// התפקידים נכתבים בערוץ האדמין (MIGRATION_DATABASE_URL), כמו בפריסה אמיתית.

import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { sslFor } from "../../src/server/repositories/pg-ssl.js";
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { findActiveDatasetId } from "../../src/server/services/dataset-provider.js";
import { answerAsStaff, getStaffScope, listRepInquiries, ForbiddenError } from "../../src/server/auth/staff.js";

const APP = process.env.DATABASE_URL;
const ADMIN = process.env.MIGRATION_DATABASE_URL;
const run = APP && ADMIN ? describe : describe.skip;

run("הרשאות נציג מול Postgres (תפקיד פעיל + היקף, deny-by-default)", () => {
  let service: CaseService;
  let admin: Client;
  const userIds: string[] = [];
  const uid = () => { const id = randomUUID(); userIds.push(id); return id; };

  beforeAll(async () => {
    service = new CaseService(new PgCaseRepository(APP!));
    if (!(await findActiveDatasetId(APP!))) throw new Error("dataset לא יובא");
    admin = new Client({ connectionString: ADMIN!, ...sslFor(ADMIN!) });
    await admin.connect();
  }, 30000);

  afterAll(async () => {
    if (admin) {
      await admin.query("delete from staff_roles where user_id = any($1)", [userIds]).catch(() => {});
      await admin.query("delete from cases where owner_id = any($1)", [userIds]).catch(() => {});
      await admin.end();
    }
  }, 30000);

  async function grant(userId: string, types: string[], active = true) {
    await admin.query(
      "insert into staff_roles(user_id, role, active, scope) values ($1,'representative',$2,$3::jsonb)",
      [userId, active, JSON.stringify({ inquiryTypes: types })],
    );
  }

  /** עובד/ת עם תיק + פנייה פתוחה על השתתפות החלופה. */
  async function employeeWithInquiry(type: "employee_participation" | "occupation_eligibility_clarification" = "employee_participation") {
    const owner = uid();
    const created = await service.createDemoCaseFromEmployee(owner, "E-001");
    const caseId = created.case.id;
    const alt = await service.pickAlternative(caseId, owner, { role: "alternative", route: "company_car", vehicleCode: "CAR-10", participation: 300, maintenanceAllowance: 0 });
    await service.computeAndSaveComparison(caseId, owner);
    const cur = await service.getCaseState(caseId, owner);
    const { inquiry } = await service.openInquiry(caseId, owner, type, alt.id, {
      type, route: alt.route, vehicle: alt.vehicleCode ?? "", group: cur!.facts.reportedGroup ?? "", factsRevision: cur!.case.factsRevision,
    });
    return { owner, caseId, altId: alt.id, inquiryId: inquiry.id };
  }

  it("deny-by-default: משתמש בלי תפקיד אין לו היקף, ואינו רואה פניות", { timeout: 40000 }, async () => {
    const plain = uid();
    expect(await getStaffScope(APP!, plain)).toBeNull();
    await expect(listRepInquiries(APP!, plain)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("עובד רגיל לא יכול לענות גם בקריאה ישירה עם מזהה פנייה תקף", { timeout: 40000 }, async () => {
    const e = await employeeWithInquiry();
    // העובד/ת עצמו/ה: בעל התיק, אבל לא נציג. מזהה הפנייה תקף ושלו.
    await expect(
      answerAsStaff(service, APP!, e.owner, e.inquiryId, { value: 900, note: null, effectiveFrom: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // עובד/ת אחר/ת: אותו דבר.
    const other = uid();
    await expect(
      answerAsStaff(service, APP!, other, e.inquiryId, { value: 900, note: null, effectiveFrom: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // לא נרשמה תשובה ולא הוחל דבר.
    const after = await service.getCaseState(e.caseId, e.owner);
    expect(after!.openInquiries.find((q) => q.id === e.inquiryId)!.status).toBe("open");
    expect(after!.scenarios.find((s) => s.id === e.altId)!.participation).toBe(300);
  });

  it("נציג מורשה רואה את הפנייה בהקשר מצומצם בלבד (בלי שכר/מייל/בעלים)", { timeout: 40000 }, async () => {
    const e = await employeeWithInquiry();
    const rep = uid();
    await grant(rep, ["employee_participation"]);
    const list = await listRepInquiries(APP!, rep);
    const item = list.find((x) => x.inquiry.id === e.inquiryId);
    expect(item).toBeTruthy();
    expect(item!.route).toBe("company_car");
    expect(item!.reportedGroup).toBe("ג");
    const keys = JSON.stringify(Object.keys(item!)) + JSON.stringify(Object.keys(item!.inquiry));
    // שמות שדות של נתונים רגישים (currentFactsRevision הוא מספר גרסה בלבד, לא נתוני עובדות).
    for (const forbidden of ["owner", "email", "salary", "commission", "bonus", "pension", "net"]) {
      expect(keys.toLowerCase()).not.toContain(forbidden);
    }
    // ושום ערך רגיש לא מופיע בערכים: אין מייל/מזהה בעלים בתוצאה המלאה.
    const blob = JSON.stringify(item);
    expect(blob).not.toContain("@");
    expect(blob).not.toContain(e.owner);
  });

  it("נציג מורשה עונה: התשובה מוחלת ונרשם audit; העובד/ת רואה את התוצאה", { timeout: 60000 }, async () => {
    const e = await employeeWithInquiry();
    const rep = uid();
    await grant(rep, ["employee_participation"]);
    const before = await service.getCaseState(e.caseId, e.owner);
    const res = await answerAsStaff(service, APP!, rep, e.inquiryId, { value: 900, note: "אושר", effectiveFrom: null });
    expect(res.status).toBe("applied");
    const after = await service.getCaseState(e.caseId, e.owner);
    expect(after!.scenarios.find((s) => s.id === e.altId)!.participation).toBe(900);
    expect(after!.latestComparison!.result.netDeltaDisplay).toBeLessThan(before!.latestComparison!.result.netDeltaDisplay);
    const a = await admin.query("select answered_by, status from inquiries where id = $1", [e.inquiryId]);
    expect(a.rows[0].status).toBe("answered");
    expect(a.rows[0].answered_by).toBe(rep);
  });

  it("היקף: נציג של סוג אחד אינו רואה ואינו עונה על סוג אחר, ואינו יודע שהוא קיים", { timeout: 60000 }, async () => {
    const e = await employeeWithInquiry("occupation_eligibility_clarification");
    const rep = uid();
    await grant(rep, ["employee_participation"]); // לא כולל הבהרת זכאות
    const list = await listRepInquiries(APP!, rep);
    expect(list.find((x) => x.inquiry.id === e.inquiryId)).toBeFalsy();
    await expect(
      answerAsStaff(service, APP!, rep, e.inquiryId, { value: null, note: "x", effectiveFrom: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // מזהה שאינו קיים בכלל: אותה שגיאה בדיוק (אין הבחנה בין "אסור" ל"לא קיים").
    await expect(
      answerAsStaff(service, APP!, rep, randomUUID(), { value: 1, note: null, effectiveFrom: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("תפקיד שבוטל (active=false) מאבד גישה מיד", { timeout: 40000 }, async () => {
    const e = await employeeWithInquiry();
    const rep = uid();
    await grant(rep, ["employee_participation"]);
    expect(await getStaffScope(APP!, rep)).not.toBeNull();
    await admin.query("update staff_roles set active = false where user_id = $1", [rep]);
    expect(await getStaffScope(APP!, rep)).toBeNull();
    await expect(
      answerAsStaff(service, APP!, rep, e.inquiryId, { value: 900, note: null, effectiveFrom: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("אי אפשר להעניק לעצמך תפקיד: תפקיד האפליקציה אינו כותב ל-staff_roles", { timeout: 40000 }, async () => {
    const sneaky = uid();
    const c = new Client({ connectionString: APP!, ...sslFor(APP!) });
    await c.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.owner_id', $1, true)", [sneaky]);
      await expect(
        c.query("insert into staff_roles(user_id, role, scope) values ($1,'representative','{\"inquiryTypes\":[\"employee_participation\"]}')", [sneaky]),
      ).rejects.toThrow(/permission denied/i);
      await c.query("rollback");
    } finally { await c.end(); }
    expect(await getStaffScope(APP!, sneaky)).toBeNull();
  });

  it("משתמש קורא רק את שורת התפקיד של עצמו (RLS על staff_roles)", { timeout: 40000 }, async () => {
    const a = uid(); const b = uid();
    await grant(a, ["employee_participation"]);
    await grant(b, ["occupation_eligibility_clarification"]);
    const c = new Client({ connectionString: APP!, ...sslFor(APP!) });
    await c.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.owner_id', $1, true)", [a]);
      const r = await c.query("select user_id from staff_roles where user_id = any($1)", [[a, b]]);
      await c.query("rollback");
      expect(r.rows.map((x) => x.user_id)).toEqual([a]);
    } finally { await c.end(); }
  });
});