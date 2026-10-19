// src/server/auth/staff.ts
// הרשאות נציג. תפקיד פעיל + היקף (סוגי פניות) נקבעים בשרת בלבד, מטבלת staff_roles
// שנכתבת רק בערוץ ניהולי. deny-by-default: בלי שורה פעילה אין שום גישה.
// כל הפונקציות מקבלות מזהה משתמש מפורש (מהסשן המאומת), בלי next/headers,
// כדי שיהיו ניתנות לבדיקה ישירה מול Postgres.

import { getPool } from "../repositories/pg-pool.js";
import type { InquiryRecord, InquiryType } from "../../domain/contracts/case.js";
import type { CaseService } from "../services/case-service.js";
import { enqueueNotification } from "../notify/queue.js";
import { sendForInquiryNow } from "../notify/worker.js";

export interface StaffScope { inquiryTypes: InquiryType[] }

/** שגיאת הרשאה: הנציג אינו מורשה (או שאינו נציג). ה-UI מציג הודעה כללית. */
export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

const KNOWN_TYPES: ReadonlySet<string> = new Set(["employee_participation", "occupation_eligibility_clarification"]);

/** טרנזקציה קצרה עם הזהות המאומתת ב-app.owner_id (כמו ה-repository). */
async function withIdentity<T>(conn: string, userId: string, fn: (c: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool(conn).connect();
  let released = false;
  const release = (destroy?: boolean) => { if (!released) { released = true; client.release(destroy); } };
  try {
    await client.query("begin");
    await client.query("select set_config('app.owner_id', $1, true)", [userId]);
    const out = await fn(client);
    await client.query("commit");
    release();
    return out;
  } catch (e) {
    try { await client.query("rollback"); } catch { /* חיבור אולי מת */ }
    release(true);
    throw e;
  }
}

/** היקף הנציג של המשתמש; null אם אין תפקיד פעיל. הסינון לסוגים מוכרים בלבד. */
export async function getStaffScope(conn: string, userId: string): Promise<StaffScope | null> {
  const types = await withIdentity(conn, userId, async (c) => {
    const r = await c.query("select staff_inquiry_types() as t");
    return (r.rows[0]?.t as string[] | null) ?? [];
  });
  const known = types.filter((t): t is InquiryType => KNOWN_TYPES.has(t));
  return known.length > 0 ? { inquiryTypes: known } : null;
}

export interface RepInquiryView {
  inquiry: InquiryRecord;
  currentFactsRevision: number;
  scenarioRole: "baseline" | "alternative" | null;
  route: "company_car" | "family" | "waiver" | null;
  vehicleCode: string | null;
  reportedGroup: string | null;
  currentParticipation: number | null;
}

/** פניות בהיקף הנציג עם הקשר מצומצם. ללא תפקיד: ForbiddenError. */
export async function listRepInquiries(conn: string, userId: string): Promise<RepInquiryView[]> {
  const scope = await getStaffScope(conn, userId);
  if (!scope) throw new ForbiddenError("not_staff");
  return await withIdentity(conn, userId, async (c) => {
    const r = await c.query("select * from rep_list_inquiries()");
    return r.rows.map((row) => ({
      inquiry: {
        id: row.inquiry_id as string,
        caseId: row.case_id as string,
        type: row.inq_type as InquiryType,
        scenarioId: (row.scenario_id as string) ?? null,
        contextFingerprint: row.context_fingerprint as string,
        status: row.inq_status as InquiryRecord["status"],
        createdAt: new Date(row.created_at as string).toISOString(),
        answerValue: row.answer_value === null ? null : Number(row.answer_value),
        answerNote: (row.answer_note as string) ?? null,
        effectiveFrom: row.effective_from ? new Date(row.effective_from as string).toISOString().slice(0, 10) : null,
        answeredAt: row.answered_at ? new Date(row.answered_at as string).toISOString() : null,
      },
      currentFactsRevision: row.facts_revision as number,
      scenarioRole: (row.scenario_role as RepInquiryView["scenarioRole"]) ?? null,
      route: (row.route as RepInquiryView["route"]) ?? null,
      vehicleCode: (row.vehicle_code as string) ?? null,
      reportedGroup: (row.reported_group as string) ?? null,
      currentParticipation: row.participation === null ? null : Number(row.participation),
    }));
  });
}

export type RepAnswerOutcome = Awaited<ReturnType<CaseService["answerAndApplyInquiry"]>>;

/**
 * מענה נציג על פנייה: מאמת תפקיד פעיל + היקף לפני כל פעולה, ורק אז מחיל בשם בעל התיק.
 * עובד רגיל (בלי תפקיד) או נציג מחוץ להיקף: ForbiddenError, בלי לחשוף אם הפנייה קיימת.
 * הבעלים נקבע בשרת מתוך rep_inquiry_owner() ולעולם לא מגיע מהלקוח.
 */
export async function answerAsStaff(
  service: CaseService,
  conn: string,
  staffUserId: string,
  inquiryId: string,
  answer: { value: number | null; note: string | null; effectiveFrom: string | null },
  options?: { today?: string },
): Promise<RepAnswerOutcome> {
  const scope = await getStaffScope(conn, staffUserId);
  if (!scope) throw new ForbiddenError("not_staff");
  const ownerId = await withIdentity(conn, staffUserId, async (c) => {
    const r = await c.query("select rep_inquiry_owner($1::uuid) as o", [inquiryId]);
    return (r.rows[0]?.o as string | null) ?? null;
  });
  // מחוץ להיקף / לא קיים: אותה תשובה בדיוק (אין חשיפת קיום).
  if (!ownerId) throw new ForbiddenError("out_of_scope");
  const res = await service.answerAndApplyInquiry(inquiryId, ownerId, answer, options);
  await withIdentity(conn, ownerId, async (c) => {
    // audit: מי ענה. מתבצע בהקשר הבעלים כי טבלת inquiries כפופה ל-RLS שלו.
    await c.query("update inquiries set answered_by = $2 where id = $1", [inquiryId, staffUserId]);
  }).catch(() => { /* audit best-effort; התשובה כבר נרשמה */ });

  // התראת מייל עמידה: נוצרת בהקשר הבעלים (RLS), idempotent לפי (inquiry, kind).
  // comparison_ready רק כשהתשובה הוחלה *וחושבה מחדש* בפועל; אחרת answer_recorded
  // (תשובה נרשמה אך טרם הוחלה - לעולם לא "ההשוואה מוכנה"). כשל כאן אינו מבטל את
  // התשובה/החישוב שכבר נשמרו.
  if (res.status !== "not_found" && res.caseId) {
    const kind = res.status === "applied" && res.recomputed === true ? "comparison_ready" : "answer_recorded";
    await enqueueNotification(conn, ownerId, { caseId: res.caseId, inquiryId, kind })
      .catch((e) => { console.warn("[notify] enqueue failed: " + (e instanceof Error ? e.name : "Error")); });
    // משלוח מיידי best-effort סמוך לתשובה (אחרי שנשמרה). כשל/חוסר-הגדרה אינם
    // מפילים את התשובה - המשימה נשארת ל-retry ע"י המתזמן.
    await sendForInquiryNow(inquiryId)
      .catch((e) => { console.warn("[notify] immediate send failed: " + (e instanceof Error ? e.name : "Error")); });
  }
  return res;
}