// tests/integration/pg-demo-rep.test.ts
// גישת התנסות כנציג מול Postgres אמיתי (RLS + SECURITY DEFINER). ללא מודל וללא שליחת מייל.
// מאמת: דגל כבוי כברירת מחדל (גם בסשן קיים), זריעה אידמפוטנטית, בידוד בין מתנסות,
// אי-הרחבת הרשאה (קריאה ישירה, פנייה של אחר, זריעה בשם אחר), בידוד מנציגים רגילים,
// התראות רק לבעל הבירור האמיתי, ושרשרת פנייה -> מענה -> החלה -> חישוב מחדש -> שחזור.
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { sslFor } from "../../src/server/repositories/pg-ssl.js";
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { findActiveDatasetId } from "../../src/server/services/dataset-provider.js";
import { ForbiddenError, listRepInquiries, answerAsStaff, type RepInquiryView } from "../../src/server/auth/staff.js";
import {
  DemoDisabledError, enrollInDemo, isDemoEnrolled, listDemoInquiries, answerAsDemo,
  DEMO_SEEDS, syntheticOwnerId,
} from "../../src/server/auth/demo-rep.js";
import { resolveRepAccess, answerAsRep } from "../../src/server/auth/rep-access.js";

const APP = process.env.DATABASE_URL;
const ADMIN = process.env.MIGRATION_DATABASE_URL;
const run = APP && ADMIN ? describe : describe.skip;
const FLAG = "REP_DEMO_ACCESS_ENABLED";

run("התנסות כנציג: הרשאות, בידוד, זריעה והתראות", () => {
  let service: CaseService;
  let admin: Client;
  const userIds: string[] = [];
  const uid = () => { const id = randomUUID(); userIds.push(id); return id; };
  let savedFlag: string | undefined;

  const A = uid();
  const B = uid();

  const byVehicle = (list: RepInquiryView[], code: string) => list.find((q) => q.vehicleCode === code)!;
  const eligibility = (list: RepInquiryView[]) => list.find((q) => q.inquiry.type === "occupation_eligibility_clarification")!;
  const ans = (value: number | null, extra: { note?: string | null; effectiveFrom?: string | null } = {}) =>
    ({ value, note: extra.note ?? null, effectiveFrom: extra.effectiveFrom ?? null });

  beforeAll(async () => {
    savedFlag = process.env[FLAG];
    process.env[FLAG] = "1";
    service = new CaseService(new PgCaseRepository(APP!));
    if (!(await findActiveDatasetId(APP!))) throw new Error("dataset לא יובא");
    admin = new Client({ connectionString: ADMIN!, ...sslFor(ADMIN!) });
    await admin.connect();
    // שתי מתנסות רשומות מראש (זריעה לוקחת זמן; משתמשים בה בכמה בדיקות).
    await Promise.all([enrollInDemo(service, APP!, A), enrollInDemo(service, APP!, B)]);
  }, 180000);

  afterAll(async () => {
    if (savedFlag === undefined) delete process.env[FLAG]; else process.env[FLAG] = savedFlag;
    if (admin) {
      const owners = [...userIds, ...userIds.map(syntheticOwnerId)];
      await admin.query("delete from notification_jobs where recipient_user_id = any($1)", [owners]).catch(() => {});
      await admin.query("delete from staff_roles where user_id = any($1)", [userIds]).catch(() => {});
      await admin.query("delete from rep_demo_access where user_id = any($1)", [userIds]).catch(() => {});
      await admin.query("delete from cases where owner_id = any($1)", [owners]).catch(() => {}); // scope: ON DELETE CASCADE
      await admin.end();
    }
  }, 60000);

  /** עובד/ת אמיתי/ת עם תיק + פנייה פתוחה על השתתפות החלופה (כמו פנייה מהשיחה). */
  async function ownInquiry(owner: string) {
    const created = await service.createDemoCaseFromEmployee(owner, "E-001");
    const caseId = created.case.id;
    const alt = await service.pickAlternative(caseId, owner, { role: "alternative", route: "company_car", vehicleCode: "CAR-10", participation: 300, maintenanceAllowance: 0 });
    await service.computeAndSaveComparison(caseId, owner);
    const cur = await service.getCaseState(caseId, owner);
    const { inquiry } = await service.openInquiry(caseId, owner, "employee_participation", alt.id, {
      type: "employee_participation", route: alt.route, vehicle: alt.vehicleCode ?? "", group: cur!.facts.reportedGroup ?? "", factsRevision: cur!.case.factsRevision,
    });
    return { caseId, altId: alt.id, inquiryId: inquiry.id };
  }

  const jobsForCase = async (caseId: string) =>
    (await admin.query("select kind, recipient_user_id from notification_jobs where case_id = $1", [caseId])).rows;

  // ---------- הדגל ----------
  it("הדגל כבוי כברירת מחדל: אין הצטרפות, קריאה או מענה", { timeout: 60000 }, async () => {
    const saved = process.env[FLAG];
    delete process.env[FLAG];
    try {
      const fresh = uid();
      await expect(enrollInDemo(service, APP!, fresh)).rejects.toBeInstanceOf(DemoDisabledError);
      expect(await isDemoEnrolled(APP!, A)).toBe(false);
      expect(await resolveRepAccess(APP!, A)).toEqual({ mode: "none", demoAvailable: false });
      await expect(listDemoInquiries(APP!, A)).rejects.toBeInstanceOf(ForbiddenError);
      const rows = await admin.query("select 1 from rep_demo_access where user_id = $1", [fresh]);
      expect(rows.rowCount).toBe(0); // לא נרשם בכלל
    } finally { process.env[FLAG] = saved; }
  });

  it("כיבוי הדגל אחרי שהמשתמש/ת כבר הצטרף/ה חוסם גם מענה על פנייה שלו/ה (סשן קיים)", { timeout: 60000 }, async () => {
    const list = await listDemoInquiries(APP!, A);
    const target = byVehicle(list, "CAR-10");
    const saved = process.env[FLAG];
    process.env[FLAG] = "0";
    try {
      await expect(answerAsDemo(service, APP!, A, target.inquiry.id, ans(777))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(answerAsRep(service, APP!, A, target.inquiry.id, ans(777))).rejects.toBeInstanceOf(ForbiddenError);
    } finally { process.env[FLAG] = saved; }
    const after = await listDemoInquiries(APP!, A);
    expect(byVehicle(after, "CAR-10").inquiry.status).toBe("open"); // לא נרשמה תשובה
  });

  // ---------- זריעה ----------
  it("הצטרפות זורעת פניות פיקטיביות בתחום פרטי, בבעלות סינתטית, בלי מייל", { timeout: 60000 }, async () => {
    const list = await listDemoInquiries(APP!, A);
    expect(list).toHaveLength(DEMO_SEEDS.length);
    expect(list.every((q) => q.origin === "seeded" && q.inquiry.status === "open")).toBe(true);
    const owners = await admin.query(
      "select distinct c.owner_id from demo_inquiry_scope d join inquiries i on i.id=d.inquiry_id join cases c on c.id=i.case_id where d.demo_user_id=$1", [A]);
    expect(owners.rows.map((r) => r.owner_id)).toEqual([syntheticOwnerId(A)]);
    // אין התראה כלל על תיקי הזריעה, ואין בעלות על שם המשתמש/ת האמיתי/ת.
    const jobs = await admin.query("select 1 from notification_jobs where recipient_user_id = any($1)", [[A, syntheticOwnerId(A)]]);
    expect(jobs.rowCount).toBe(0);
    const mine = await service.listCaseSummaries(A, 50);
    expect(mine).toHaveLength(0); // פניות הדוגמה אינן מתערבבות עם הבירורים של המשתמש/ת
  });

  it("זריעה אידמפוטנטית: הצטרפות חוזרת ובמקביל לא משכפלת תיקים או פניות", { timeout: 120000 }, async () => {
    const again = await enrollInDemo(service, APP!, A);
    expect(again.created).toBe(0);
    const C = uid();
    await Promise.all([enrollInDemo(service, APP!, C), enrollInDemo(service, APP!, C)]);
    const scope = await admin.query("select count(*)::int as n from demo_inquiry_scope where demo_user_id=$1", [C]);
    expect(scope.rows[0].n).toBe(DEMO_SEEDS.length);
    const cases = await admin.query("select count(*)::int as n from cases where owner_id=$1", [syntheticOwnerId(C)]);
    expect(cases.rows[0].n).toBe(DEMO_SEEDS.length); // אין תיקים יתומים אחרי מרוץ
  });

  // ---------- בידוד והרשאות ----------
  it("שתי מתנסות אינן רואות ואינן עונות על הפניות זו של זו", { timeout: 60000 }, async () => {
    const la = await listDemoInquiries(APP!, A);
    const lb = await listDemoInquiries(APP!, B);
    const ids = new Set(la.map((q) => q.inquiry.id));
    expect(lb.some((q) => ids.has(q.inquiry.id))).toBe(false);
    const bTarget = byVehicle(lb, "CAR-10");
    await expect(answerAsDemo(service, APP!, A, bTarget.inquiry.id, ans(111))).rejects.toBeInstanceOf(ForbiddenError);
    const after = await listDemoInquiries(APP!, B);
    expect(byVehicle(after, "CAR-10").inquiry.status).toBe("open");
  });

  it("משתמש/ת שלא הצטרף/ה: אין גישה גם עם מזהה פנייה תקף; מזהה לא קיים נראה זהה", { timeout: 60000 }, async () => {
    const outsider = uid();
    const target = byVehicle(await listDemoInquiries(APP!, A), "CAR-10");
    await expect(listDemoInquiries(APP!, outsider)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(answerAsDemo(service, APP!, outsider, target.inquiry.id, ans(1))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(answerAsDemo(service, APP!, outsider, randomUUID(), ans(1))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await resolveRepAccess(APP!, outsider)).toEqual({ mode: "none", demoAvailable: true });
  });

  it("הצטרפות להתנסות אינה נותנת הרשאת נציג ארגונית: פניות אמיתיות של אחרים נחסמות", { timeout: 60000 }, async () => {
    const victim = uid();
    const real = await ownInquiry(victim);
    await expect(answerAsDemo(service, APP!, A, real.inquiryId, ans(900))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(answerAsRep(service, APP!, A, real.inquiryId, ans(900))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listDemoInquiries(APP!, A)).some((q) => q.inquiry.id === real.inquiryId)).toBe(false);
    const st = await service.getCaseState(real.caseId, victim);
    expect(st!.openInquiries.find((q) => q.id === real.inquiryId)!.status).toBe("open");
    expect(st!.scenarios.find((s) => s.id === real.altId)!.participation).toBe(300);
  });

  it("מתנסה רואה רק את הפניות של עצמו: פנייה של אחר/ת אינה מופיעה ואין אפשרות לענות עליה", { timeout: 90000 }, async () => {
    const victim = uid();
    const theirs = await ownInquiry(victim);
    const list = await listDemoInquiries(APP!, A);
    expect(list.some((q) => q.inquiry.id === theirs.inquiryId)).toBe(false);
    expect(list.every((q) => q.origin === "seeded" || q.origin === "owned")).toBe(true);
    await expect(answerAsDemo(service, APP!, A, theirs.inquiryId, ans(1))).rejects.toBeInstanceOf(ForbiddenError);
    // ה-API הישיר ל-DB: גם אם מנסים לצרף/לשייך ידנית, הפונקציות הישנות הוסרו.
    const c = new Client({ connectionString: APP!, ...sslFor(APP!) });
    await c.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.owner_id', $1, true)", [A]);
      await expect(c.query("select demo_rep_attach($1::uuid)", [theirs.inquiryId])).rejects.toThrow(/does not exist/i);
      await c.query("rollback");
    } finally { await c.end(); }
  });

  it("זריעה בשם אחר נחסמת: אי אפשר לשייך להיקף שלי תיק סינתטי של מישהו אחר", { timeout: 60000 }, async () => {
    const bTarget = byVehicle(await listDemoInquiries(APP!, B), "CAR-10");
    const c = new Client({ connectionString: APP!, ...sslFor(APP!) });
    await c.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.owner_id', $1, true)", [A]);
      const r = await c.query("select demo_rep_register_seed($1::uuid, 'steal') as ok", [bTarget.inquiry.id]);
      expect(r.rows[0].ok).toBe(false);
      await c.query("rollback");
    } finally { await c.end(); }
  });

  it("תפקיד האפליקציה אינו קורא או כותב ישירות לטבלאות ההדגמה", { timeout: 60000 }, async () => {
    const c = new Client({ connectionString: APP!, ...sslFor(APP!) });
    await c.connect();
    try {
      for (const sql of [
        "select * from demo_inquiry_scope",
        "select * from rep_demo_access",
        "insert into rep_demo_access(user_id) values ('x')",
        "insert into demo_inquiry_scope(inquiry_id, demo_user_id, origin) values (gen_random_uuid(), 'x', 'owned')",
      ]) {
        await c.query("begin");
        await c.query("select set_config('app.owner_id', $1, true)", [A]);
        await expect(c.query(sql)).rejects.toThrow(/permission denied/i);
        await c.query("rollback");
      }
    } finally { await c.end(); }
  });

  it("נציגים רגילים אינם רואים או עונים על פניות שנזרעו", { timeout: 90000 }, async () => {
    const staff = uid();
    await admin.query("insert into staff_roles(user_id, role, active, scope) values ($1,'representative',true,$2::jsonb)",
      [staff, JSON.stringify({ inquiryTypes: ["employee_participation", "occupation_eligibility_clarification"] })]);
    const seeded = await listDemoInquiries(APP!, A);
    const list = await listRepInquiries(APP!, staff);
    const staffIds = new Set(list.map((q) => q.inquiry.id));
    expect(seeded.some((q) => staffIds.has(q.inquiry.id))).toBe(false);
    await expect(answerAsStaff(service, APP!, staff, seeded[0]!.inquiry.id, ans(5))).rejects.toBeInstanceOf(ForbiddenError);
    // נציג רגיל נשאר ראשון בהכרעה: מצב staff, לא demo.
    expect(await resolveRepAccess(APP!, staff)).toEqual({ mode: "staff" });
    // ביטול ההרשאה הרגילה חוסם מיד גם דרך נקודת הכניסה המאוחדת.
    await admin.query("update staff_roles set active=false where user_id=$1", [staff]);
    await expect(answerAsRep(service, APP!, staff, seeded[0]!.inquiry.id, ans(5))).rejects.toBeInstanceOf(ForbiddenError);
  });

  // ---------- מענה: אותה לוגיקה עסקית ----------
  it("פנייה שנזרעה: מענה מוחל ומחשב מחדש; מענה חוזר אינו מחיל פעמיים; ללא מייל", { timeout: 120000 }, async () => {
    const target = byVehicle(await listDemoInquiries(APP!, A), "CAR-10");
    const before = await service.getCaseState(target.inquiry.caseId, syntheticOwnerId(A));
    const res = await answerAsDemo(service, APP!, A, target.inquiry.id, ans(900, { note: "אושר" }));
    expect(res.status).toBe("applied");
    expect(res.recomputed).toBe(true);
    const rev1 = (await admin.query("select revision, participation from scenarios where id=$1", [target.inquiry.scenarioId])).rows[0];
    expect(Number(rev1.participation)).toBe(900);
    // מענה חוזר זהה: לא נוגע שוב בתרחיש (revision ללא שינוי).
    const again = await answerAsDemo(service, APP!, A, target.inquiry.id, ans(900, { note: "אושר" }));
    expect(again.status).toBe("applied");
    const rev2 = (await admin.query("select revision from scenarios where id=$1", [target.inquiry.scenarioId])).rows[0];
    expect(rev2.revision).toBe(rev1.revision);
    // תיקון לגיטימי מותר: ערך חדש מוחל.
    const fix = await answerAsDemo(service, APP!, A, target.inquiry.id, ans(0, { note: "תיקון" }));
    expect(fix.status).toBe("applied");
    const rev3 = (await admin.query("select participation from scenarios where id=$1", [target.inquiry.scenarioId])).rows[0];
    expect(Number(rev3.participation)).toBe(0); // אפס מפורש הוא ערך ולא "חסר"
    const st = await service.getCaseState(target.inquiry.caseId, syntheticOwnerId(A));
    expect(st!.latestComparison!.result.netDeltaDisplay).not.toBe(before!.latestComparison!.result.netDeltaDisplay);
    expect(await jobsForCase(target.inquiry.caseId)).toHaveLength(0); // פנייה שנזרעה: אין התראה
    const saved = (await listDemoInquiries(APP!, A)).find((q) => q.inquiry.id === target.inquiry.id)!;
    expect(saved.inquiry.status).toBe("answered");
    expect(saved.inquiry.answerValue).toBe(0);
  });

  it("הקשר מיושן נשמר ולא מוחל; תחולה עתידית נשמרת ולא מוחלת; הבהרה נרשמת בלבד", { timeout: 120000 }, async () => {
    const list = await listDemoInquiries(APP!, B);
    const stale = byVehicle(list, "CAR-06");
    const family = byVehicle(list, "CAR-19");
    const elig = eligibility(list);

    const before = Number((await admin.query("select participation from scenarios where id=$1", [stale.inquiry.scenarioId])).rows[0].participation);
    const s = await answerAsDemo(service, APP!, B, stale.inquiry.id, ans(555));
    expect(s.status).toBe("stale_context");
    const afterStale = Number((await admin.query("select participation from scenarios where id=$1", [stale.inquiry.scenarioId])).rows[0].participation);
    expect(afterStale).toBe(before);

    const f = await answerAsDemo(service, APP!, B, family.inquiry.id, ans(650, { effectiveFrom: "2999-01-01" }), { today: "2026-01-01" });
    expect(f.status).toBe("future_effective");
    const famBefore = Number(family.currentParticipation);
    const famAfter = Number((await admin.query("select participation from scenarios where id=$1", [family.inquiry.scenarioId])).rows[0].participation);
    expect(famAfter).toBe(famBefore);

    const e = await answerAsDemo(service, APP!, B, elig.inquiry.id, ans(null, { note: "העיסוק מזכה בקבוצה ג" }));
    expect(e.status).toBe("recorded_not_applied");
    const rows = await listDemoInquiries(APP!, B);
    for (const id of [stale.inquiry.id, family.inquiry.id, elig.inquiry.id]) {
      expect(rows.find((q) => q.inquiry.id === id)!.inquiry.status).toBe("answered"); // התשובה נשמרה
    }
    for (const q of [stale, family, elig]) expect(await jobsForCase(q.inquiry.caseId)).toHaveLength(0);
  });

  it("מי ששלח/ה פנייה נכנס/ת כנציג ועונה לעצמו/ה: מענה -> החלה -> התראה לבעל/ת הבירור -> שחזור השיחה", { timeout: 180000 }, async () => {
    const D = uid();
    const mine = await ownInquiry(D);
    await service.appendMessages(mine.caseId, D, [
      { role: "user", clientMessageId: "u1", content: [{ type: "text", text: "אפשר לבדוק השתתפות?" }] },
      { role: "assistant", clientMessageId: "a1", content: [{ type: "text", text: "פתחתי פנייה לנציג." }] },
    ]);

    // לפני ההצטרפות להתנסות: אין גישה, גם לפנייה של עצמו/ה.
    await expect(listDemoInquiries(APP!, D)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(answerAsDemo(service, APP!, D, mine.inquiryId, ans(800))).rejects.toBeInstanceOf(ForbiddenError);

    // אחרי ההצטרפות: הפנייה של עצמו/ה מופיעה אוטומטית (בלי שלב צירוף), לצד פניות הדוגמה.
    await enrollInDemo(service, APP!, D);
    const all = await listDemoInquiries(APP!, D);
    const listed = all.find((q) => q.inquiry.id === mine.inquiryId)!;
    expect(listed.origin).toBe("owned");
    expect(all.filter((q) => q.origin === "seeded")).toHaveLength(DEMO_SEEDS.length);
    // לא מחזיר שכר/מייל/בעלים.
    const blob = JSON.stringify(listed);
    expect(blob).not.toContain("@");
    expect(blob).not.toContain(D);

    // משתמשת אחרת לא רואה אותה.
    expect((await listDemoInquiries(APP!, B)).some((q) => q.inquiry.id === mine.inquiryId)).toBe(false);
    await expect(answerAsDemo(service, APP!, B, mine.inquiryId, ans(1))).rejects.toBeInstanceOf(ForbiddenError);

    const res = await answerAsDemo(service, APP!, D, mine.inquiryId, ans(850, { note: "אושר להדגמה" }));
    expect(res.status).toBe("applied");
    expect(res.recomputed).toBe(true);

    // התראה: משימה אחת, לנמען הנכון בלבד (בעל/ת הבירור המאומת/ת), בלי תוכן פיננסי בשורה.
    const jobs = await jobsForCase(mine.caseId);
    expect(jobs).toEqual([{ kind: "comparison_ready", recipient_user_id: D }]);

    // שחזור: ההיסטוריה, התשובה והכרטיס המעודכן זמינים לבעלת הבירור גם אחרי ניתוק.
    const state = await service.getCaseState(mine.caseId, D);
    expect(state!.scenarios.find((s) => s.id === mine.altId)!.participation).toBe(850);
    expect(state!.openInquiries.find((q) => q.id === mine.inquiryId)!.status).toBe("answered");
    expect(state!.latestComparison).toBeTruthy();
    const msgs = await service.loadMessages(mine.caseId, D);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});
