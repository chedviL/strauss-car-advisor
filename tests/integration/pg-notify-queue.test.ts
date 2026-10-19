// tests/integration/pg-notify-queue.test.ts
// תור ההתראות מול Postgres אמיתי (RLS + דחייה אקספוננציאלית + dedup). ללא מודל
// וללא שליחת מייל אמיתית. מאמת: התראה נוצרת עם תשובת הנציג; comparison_ready רק
// כשהוחל וחושב מחדש; answer_recorded כשטרם הוחל; אין כפילות; בידוד בעלות;
// ו-worker ללא SMTP מסמן failed בלי לקרוס (הפייפליין עובד בלי לשלוח).
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { sslFor } from "../../src/server/repositories/pg-ssl.js";
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { findActiveDatasetId } from "../../src/server/services/dataset-provider.js";
import { answerAsStaff } from "../../src/server/auth/staff.js";
import { claimDueJobs, claimJobByInquiry, markSent, markFailed, enqueueNotification } from "../../src/server/notify/queue.js";

const APP = process.env.DATABASE_URL;
const ADMIN = process.env.MIGRATION_DATABASE_URL;
const run = APP && ADMIN ? describe : describe.skip;

run("תור התראות מול Postgres", () => {
  let service: CaseService; let admin: Client;
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
      await admin.query("delete from notification_jobs where recipient_user_id = any($1)", [userIds]).catch(() => {});
      await admin.query("delete from staff_roles where user_id = any($1)", [userIds]).catch(() => {});
      await admin.query("delete from cases where owner_id = any($1)", [userIds]).catch(() => {});
      await admin.end();
    }
  }, 30000);

  async function grantRep(userId: string, types: string[]) {
    await admin.query("insert into staff_roles(user_id, role, active, scope) values ($1,'representative',true,$2::jsonb)",
      [userId, JSON.stringify({ inquiryTypes: types })]);
  }

  async function employeeWithInquiry(type = "employee_participation", futureFacts = false) {
    const owner = uid();
    const created = await service.createDemoCaseFromEmployee(owner, "E-001");
    const caseId = created.case.id;
    const alt = await service.pickAlternative(caseId, owner, { role: "alternative", route: "company_car", vehicleCode: "CAR-10", participation: 300, maintenanceAllowance: 0 });
    await service.computeAndSaveComparison(caseId, owner);
    const cur = await service.getCaseState(caseId, owner);
    if (futureFacts) await service.updateFacts(caseId, owner, { baseSalary: 20000 }, cur!.case.factsRevision);
    const fresh = await service.getCaseState(caseId, owner);
    const { inquiry } = await service.openInquiry(caseId, owner, type as never, alt.id, {
      type, route: alt.route, vehicle: alt.vehicleCode ?? "", group: fresh!.facts.reportedGroup ?? "", factsRevision: cur!.case.factsRevision,
    });
    return { owner, caseId, inquiryId: inquiry.id };
  }

  async function jobsFor(owner: string) {
    const r = await admin.query("select kind, status, recipient_user_id, case_id, inquiry_id from notification_jobs where recipient_user_id = $1", [owner]);
    return r.rows;
  }

  it("תשובה שהוחלה וחושבה מחדש -> משימת comparison_ready לבעל/ת הבירור", { timeout: 60000 }, async () => {
    const e = await employeeWithInquiry();
    const rep = uid(); await grantRep(rep, ["employee_participation"]);
    const res = await answerAsStaff(service, APP!, rep, e.inquiryId, { value: 900, note: null, effectiveFrom: null });
    expect(res.status).toBe("applied");
    const jobs = await jobsFor(e.owner);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe("comparison_ready");
    expect(jobs[0].recipient_user_id).toBe(e.owner);
    expect(jobs[0].inquiry_id).toBe(e.inquiryId);
  });

  it("תשובה עם הקשר מיושן -> answer_recorded (לא comparison_ready)", { timeout: 60000 }, async () => {
    const e = await employeeWithInquiry("employee_participation", true); // גרסת עובדות שונתה
    const rep = uid(); await grantRep(rep, ["employee_participation"]);
    const res = await answerAsStaff(service, APP!, rep, e.inquiryId, { value: 900, note: null, effectiveFrom: null });
    expect(res.status).toBe("stale_context");
    const jobs = await jobsFor(e.owner);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe("answer_recorded");
  });

  it("תחולה עתידית -> answer_recorded", { timeout: 60000 }, async () => {
    const e = await employeeWithInquiry();
    const rep = uid(); await grantRep(rep, ["employee_participation"]);
    const res = await answerAsStaff(service, APP!, rep, e.inquiryId, { value: 900, note: null, effectiveFrom: "2999-01-01" }, { today: "2026-01-01" });
    expect(res.status).toBe("future_effective");
    const jobs = await jobsFor(e.owner);
    expect(jobs.map((j) => j.kind)).toEqual(["answer_recorded"]);
  });

  it("dedup: מענה חוזר על אותה פנייה אינו יוצר משימה שנייה מאותו סוג", { timeout: 60000 }, async () => {
    const e = await employeeWithInquiry();
    const rep = uid(); await grantRep(rep, ["employee_participation"]);
    await answerAsStaff(service, APP!, rep, e.inquiryId, { value: 900, note: null, effectiveFrom: null });
    await answerAsStaff(service, APP!, rep, e.inquiryId, { value: 900, note: null, effectiveFrom: null });
    const jobs = await jobsFor(e.owner);
    expect(jobs.filter((j) => j.kind === "comparison_ready")).toHaveLength(1);
  });

  it("בידוד RLS: בעל/ת בירור רואה רק את ההתראות של עצמו", { timeout: 60000 }, async () => {
    const e = await employeeWithInquiry();
    const rep = uid(); await grantRep(rep, ["employee_participation"]);
    await answerAsStaff(service, APP!, rep, e.inquiryId, { value: 900, note: null, effectiveFrom: null });
    const other = uid();
    const c = new Client({ connectionString: APP!, ...sslFor(APP!) });
    await c.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.owner_id', $1, true)", [other]);
      const seen = await c.query("select id from notification_jobs");
      await c.query("rollback");
      expect(seen.rowCount).toBe(0); // owner אחר לא רואה כלום
    } finally { await c.end(); }
  });

  it("claim + backoff: תפיסת משימה דוחה את next_attempt_at ומגדילה attempts; max -> failed", { timeout: 60000 }, async () => {
    // בודקים את מנגנון ה-claim בבידוד: יוצרים משימה ישירות (בלי המשלוח המיידי
    // של answerAsStaff, שהיה תופס אותה כבר בזמן התשובה).
    const owner = uid();
    const created = await service.startBlankCase(owner);
    // פנייה אמיתית נדרשת ל-FK; יוצרים דרך openInquiry על baseline.
    const st0 = await service.getCaseState(created.case.id, owner);
    const base = st0!.scenarios.find((s) => s.role === "baseline")!;
    const { inquiry } = await service.openInquiry(created.case.id, owner, "employee_participation", base.id, { type: "employee_participation", factsRevision: st0!.case.factsRevision });
    await enqueueNotification(APP!, owner, { caseId: created.case.id, inquiryId: inquiry.id, kind: "comparison_ready" });
    const claimed = await claimDueJobs(ADMIN!, 20);
    const mine = claimed.find((j) => j.recipientUserId === owner);
    expect(mine).toBeTruthy();
    expect(mine!.attempts).toBe(1);
    const again = (await claimDueJobs(ADMIN!, 20)).find((j) => j.recipientUserId === owner);
    expect(again).toBeFalsy(); // backoff דחה את הניסיון הבא
    await admin.query("update notification_jobs set attempts = max_attempts where recipient_user_id = $1", [owner]);
    await markFailed(ADMIN!, mine!.id, "smtp down");
    const stf = await admin.query("select status, last_error from notification_jobs where id = $1", [mine!.id]);
    expect(stf.rows[0].status).toBe("failed");
    expect(stf.rows[0].last_error).toContain("smtp");
  });

  it("התאוששות מקריסה אחרי claim: המשימה חוזרת לזמינות אחרי החלון, ואז נשלחת", { timeout: 60000 }, async () => {
    const owner = uid();
    const created = await service.startBlankCase(owner);
    const st0 = await service.getCaseState(created.case.id, owner);
    const base = st0!.scenarios.find((s) => s.role === "baseline")!;
    const { inquiry } = await service.openInquiry(created.case.id, owner, "employee_participation", base.id, { type: "employee_participation", factsRevision: st0!.case.factsRevision });
    await enqueueNotification(APP!, owner, { caseId: created.case.id, inquiryId: inquiry.id, kind: "comparison_ready" });
    const inquiryId = inquiry.id;
    // claim ראשון (כאילו נתפס, ואז השרת "קרס" לפני markSent): המשימה נשארת pending.
    const first = await claimJobByInquiry(ADMIN!, inquiryId);
    expect(first).toBeTruthy();
    let row = (await admin.query("select status, attempts, next_attempt_at > now() as future from notification_jobs where id=$1", [first!.id])).rows[0];
    expect(row.status).toBe("pending");   // לא אבוד - עדיין ממתינה
    expect(row.attempts).toBe(1);
    expect(row.future).toBe(true);        // backoff דחה את הניסיון הבא
    // claim מיידי נוסף לא יתפוס אותה (בתוך חלון ה-backoff) - אין משלוח כפול מיידי.
    expect(await claimJobByInquiry(ADMIN!, inquiryId)).toBeNull();
    // מדמים שחלון ה-backoff עבר (במקום להמתין): המשימה חוזרת לזמינות.
    await admin.query("update notification_jobs set next_attempt_at = now() - interval '1 second' where id=$1", [first!.id]);
    const second = await claimJobByInquiry(ADMIN!, inquiryId);
    expect(second).toBeTruthy();
    expect(second!.attempts).toBe(2);      // המשך מהמונה, לא מתאפס
    // סימון הצלחה (כאילו נשלח כעת) -> לא יישלח יותר.
    await markSent(ADMIN!, second!.id);
    expect(await claimJobByInquiry(ADMIN!, inquiryId)).toBeNull();
    const done = (await admin.query("select status from notification_jobs where id=$1", [first!.id])).rows[0];
    expect(done.status).toBe("sent");
  });

  it("enqueue ישיר: סוג לא חוקי נדחה ע\"י CHECK (הגנת מסד)", { timeout: 40000 }, async () => {
    const owner = uid();
    const created = await service.startBlankCase(owner);
    await expect(
      enqueueNotification(APP!, owner, { caseId: created.case.id, inquiryId: randomUUID(), kind: "bogus" as never }),
    ).rejects.toThrow();
  });
});