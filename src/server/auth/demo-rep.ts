// src/server/auth/demo-rep.ts
// גישת התנסות כנציג להדגמה (מוגבלת). אינה הרשאת נציג ארגונית:
//  * נפתחת רק כשדגל השרת REP_DEMO_ACCESS_ENABLED מופעל; ברירת מחדל כבוי. כל פעולת
//    הדגמה (כולל בסשן שכבר נפתח) בודקת את הדגל מחדש - הסתרת כפתור אינה מספיקה.
//  * המתנסה (מי שלחץ "התנסות כנציג") רואה ועונה רק על: פניות פיקטיביות שנזרעו עבורו
//    (demo_inquiry_scope), ופניות שלו עצמו (בעלות לפי הסשן המאומת, נבדקת ב-DB). כך מי שפתח
//    פנייה בשיחה יכול להיכנס כנציג ולענות לעצמו. אין גישה לפניות של אחרים.
//  * הזהות היא תמיד userId מהסשן המאומת (app.owner_id); שום ערך מהלקוח אינו מרחיב הרשאה.
//  * מייל התראה: רק לפנייה שהמשתמש יצר בעצמו (owned), לכתובת המאומתת של בעל הבירור.
//    פניות שנזרעו (בעלים סינתטי 'demo-seed:<id>') אינן מייצרות התראה כלל.

import type { CaseService } from "../services/case-service.js";
import { ForbiddenError, withIdentity, mapRepRow, applyAnswerAsOwner, type RepInquiryView, type RepAnswerOutcome } from "./staff.js";
import type { InquiryType } from "../../domain/contracts/case.js";

/**
 * דגל הפעלה. ברירת מחדל: פעיל (לצורך הגשה/הדגמה).
 * לכיבוי מפורש: REP_DEMO_ACCESS_ENABLED=0 / false / off.
 * נקרא מחדש בכל קריאה.
 */
export function repDemoEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.REP_DEMO_ACCESS_ENABLED ?? "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  return true; // ברירת מחדל: פעיל
}

/** שגיאת הדגמה כבויה: מוצגת כ"forbidden" (בלי פרטים נוספים). */
export class DemoDisabledError extends ForbiddenError {
  constructor() {
    super("demo_disabled");
    this.name = "DemoDisabledError";
  }
}

function assertEnabled(): void {
  if (!repDemoEnabled()) throw new DemoDisabledError();
}

export const syntheticOwnerId = (userId: string): string => `demo-seed:${userId}`;

/** האם המשתמש הצטרף להתנסות. הדגל כבוי -> false בלי לגעת במסד. */
export async function isDemoEnrolled(conn: string, userId: string): Promise<boolean> {
  if (!repDemoEnabled()) return false;
  return await withIdentity(conn, userId, async (c) => {
    const r = await c.query("select demo_rep_is_enrolled() as e");
    return r.rows[0]?.e === true;
  });
}

// ---------- זריעה: פניות פיקטיביות לדוגמה בתחום פרטי ----------

interface SeedDef {
  key: string;
  employeeId: string;
  type: InquiryType;
  /** משנה את העובדות אחרי פתיחת הפנייה, כדי שההקשר יהיה מיושן (הדגמת stale_context). */
  makeStale?: boolean;
}

export const DEMO_SEEDS: readonly SeedDef[] = [
  { key: "participation-ev", employeeId: "E-001", type: "employee_participation" },
  { key: "participation-family", employeeId: "E-002", type: "employee_participation" },
  { key: "eligibility", employeeId: "E-004", type: "occupation_eligibility_clarification" },
  { key: "participation-stale", employeeId: "E-003", type: "employee_participation", makeStale: true },
];

/**
 * זורע את פניות הדוגמה של המשתמש. אידמפוטנטי: מפתח שכבר נזרע מדולג, ואילוץ ייחודי
 * (demo_user_id, seed_key) ב-DB חוסם כפילות גם בלחיצות מקבילות (תיק יתום נמחק).
 * הנתונים פיקטיביים (עובדי הדוגמה של האתגר), בלי פרטים אישיים ובלי כתובת מייל.
 */
export async function seedDemoInquiries(service: CaseService, conn: string, userId: string): Promise<{ created: number }> {
  assertEnabled();
  const existing = await withIdentity(conn, userId, async (c) => {
    const r = await c.query("select * from demo_rep_seeded_keys() as k");
    return new Set(r.rows.map((x) => x.k as string));
  });
  const synthetic = syntheticOwnerId(userId);
  const todo = DEMO_SEEDS.filter((s) => !existing.has(s.key));
  const results = await Promise.all(todo.map(async (seed): Promise<boolean> => {
    const state = await service.startDemoFlow(synthetic, seed.employeeId);
    const caseId = state.case.id;
    try {
      const alt = state.scenarios.find((s) => s.role === "alternative") ?? null;
      const { inquiry } = await service.openInquiry(caseId, synthetic, seed.type, alt?.id ?? null, {
        type: seed.type,
        route: alt?.route ?? "",
        vehicle: alt?.vehicleCode ?? "",
        group: state.facts.reportedGroup ?? "",
        factsRevision: state.case.factsRevision,
      });
      if (seed.makeStale) {
        await service.updateFacts(caseId, synthetic, { creditPoints: (state.facts.creditPoints ?? 2.25) + 0.25 }, state.case.factsRevision);
      }
      const registered = await withIdentity(conn, userId, async (c) => {
        const r = await c.query("select demo_rep_register_seed($1::uuid, $2) as ok", [inquiry.id, seed.key]);
        return r.rows[0]?.ok === true;
      });
      if (!registered) await service.deleteCase(caseId, synthetic); // הפסדנו מרוץ: מנקים תיק יתום
      return registered;
    } catch (e) {
      await service.deleteCase(caseId, synthetic).catch(() => {});
      throw e;
    }
  }));
  return { created: results.filter(Boolean).length };
}

/** הצטרפות להתנסות (מצריכה דגל מופעל) + זריעה אידמפוטנטית. */
export async function enrollInDemo(service: CaseService, conn: string, userId: string): Promise<{ created: number }> {
  assertEnabled();
  await withIdentity(conn, userId, async (c) => { await c.query("select demo_rep_enroll()"); });
  return await seedDemoInquiries(service, conn, userId);
}

/** רישום חשבון הדמו המשותף בלבד: הוא יטפל בפניות שלו ולא יקבל פניות seeded. */
export async function enrollDemoAccount(conn: string, userId: string): Promise<void> {
  assertEnabled();
  await withIdentity(conn, userId, async (c) => { await c.query("select demo_rep_enroll()"); });
}

// ---------- קריאה ----------

/** פניות ההדגמה של המשתמש בלבד. לא מצטרף/דגל כבוי: ForbiddenError. */
export async function listDemoInquiries(conn: string, userId: string): Promise<RepInquiryView[]> {
  assertEnabled();
  return await withIdentity(conn, userId, async (c) => {
    const enrolled = await c.query("select demo_rep_is_enrolled() as e");
    if (enrolled.rows[0]?.e !== true) throw new ForbiddenError("not_enrolled");
    const r = await c.query("select * from demo_rep_list_inquiries()");
    return r.rows.map(mapRepRow);
  });
}

// ---------- מענה ----------

/**
 * מענה בהדגמה: אותה לוגיקה כמו נציג רגיל (applyAnswerAsOwner), אבל ההרשאה היא היקף
 * ההדגמה של המשתמש בלבד. מחוץ להיקף / לא קיים / הדגל כבוי: ForbiddenError זהה.
 */
export async function answerAsDemo(
  service: CaseService,
  conn: string,
  userId: string,
  inquiryId: string,
  answer: { value: number | null; note: string | null; effectiveFrom: string | null },
  options?: { today?: string; notify?: boolean },
): Promise<RepAnswerOutcome> {
  assertEnabled();
  const access = await withIdentity(conn, userId, async (c) => {
    const r = await c.query("select owner_id, origin from demo_rep_inquiry_access($1::uuid)", [inquiryId]);
    return r.rows[0] ? { ownerId: r.rows[0].owner_id as string, origin: r.rows[0].origin as "seeded" | "owned" } : null;
  });
  if (!access) throw new ForbiddenError("out_of_scope");
  // הגנה כפולה: פנייה שנזרעה חייבת להיות בבעלות הסינתטית של המשתמש; owned - בבעלותו.
  const expectedOwner = access.origin === "seeded" ? syntheticOwnerId(userId) : userId;
  if (access.ownerId !== expectedOwner) throw new ForbiddenError("out_of_scope");
  return await applyAnswerAsOwner(
    service, conn, userId, access.ownerId, inquiryId, answer, options,
    access.origin === "owned" && options?.notify !== false,
  );
}
