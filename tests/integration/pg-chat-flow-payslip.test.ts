// tests/integration/pg-chat-flow-payslip.test.ts
// משחזר את הרצף שנכשל בשיחה האמיתית, דרך אותם שירותים וכלים (בלי מודל):
//   "הרכב שלי קורולה קרוס, השתתפות 300"  -> updateCurrentVehicle (baseline CAR-09)
//   "לעבור ל-ATTO 3, השתתפות 300"        -> manageScenarios set_alternative (CAR-10)
//   העלאת תלוש -> חילוץ -> אישור (שכר 18,500, עמלות 0, בונוס 0)
//   בקשת השוואה -> compareScenarios      -> כרטיס נשמר
// מאמת *מצב שנשמר* (לא טקסט): baseline COROLLA CROSS part 300; alternative ATTO 3
// part 300; שכר 18,500; עמלות/בונוס 0 הוחלו; payslipStatus=applied; pendingRequest
// נוקה; והתוצאה 11,032 -> 11,693, דלתא 661 ש"ח.
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { sslFor } from "../../src/server/repositories/pg-ssl.js";
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { findActiveDatasetId } from "../../src/server/services/dataset-provider.js";
import { updateCurrentVehicle } from "../../src/server/agent/tools/update-current-vehicle.js";
import { manageScenarios } from "../../src/server/agent/tools/manage-scenarios.js";
import { compareScenarios } from "../../src/server/agent/tools/compare-scenarios.js";
import type { ToolContext } from "../../src/server/agent/tool-contracts.js";

const APP = process.env.DATABASE_URL;
const ADMIN = process.env.MIGRATION_DATABASE_URL;
const run = APP && ADMIN ? describe : describe.skip;

run("רצף שיחה מלא: רכב נוכחי + חלופה + תלוש + השוואה (ללא מודל)", () => {
  let service: CaseService; let admin: Client;
  const caseIds: string[] = [];

  beforeAll(async () => {
    service = new CaseService(new PgCaseRepository(APP!));
    if (!(await findActiveDatasetId(APP!))) throw new Error("dataset לא יובא");
    admin = new Client({ connectionString: ADMIN!, ...sslFor(ADMIN!) });
    await admin.connect();
  }, 30000);

  afterAll(async () => {
    if (admin) {
      await admin.query("delete from cases where id = any($1)", [caseIds]).catch(() => {});
      await admin.end();
    }
  }, 30000);

  const ctxFor = (caseId: string, owner: string): ToolContext => ({
    ownerId: owner, caseId, staffRole: null, requestId: randomUUID(), messageId: null,
  });

  it("baseline=COROLLA CROSS part 300, alternative=ATTO 3 part 300, תלוש מוחל, כרטיס 11032->11693 דלתא 661", { timeout: 90000 }, async () => {
    const owner = "chatflow-" + randomUUID();
    const created = await service.startBlankCase(owner);
    const caseId = created.case.id; caseIds.push(caseId);
    const ctx = ctxFor(caseId, owner);

    // 1) "הרכב שלי קורולה קרוס, השתתפות 300" -> baseline, לא חלופה.
    const r1 = await updateCurrentVehicle(service, ctx, { route: "company_car", vehicleCode: "CAR-09", participation: 300 });
    expect(r1.status).toBe("success");

    // 2) "לעבור ל-ATTO 3, השתתפות 300" -> חלופה.
    const r2 = await manageScenarios(service, ctx, { operation: "set_alternative", route: "company_car", vehicleCode: "CAR-10", participation: 300 });
    expect(r2.status).toBe("success");

    // בדיקת מצב שמור: baseline ו-alternative נכונים ונפרדים.
    let st = await service.getCaseState(caseId, owner);
    const base = st!.scenarios.find((s) => s.role === "baseline")!;
    const alt = st!.scenarios.find((s) => s.role === "alternative")!;
    expect(base.vehicleCode).toBe("CAR-09");       // COROLLA CROSS = נוכחי
    expect(base.participation).toBe(300);
    expect(alt.vehicleCode).toBe("CAR-10");        // ATTO 3 = חלופה
    expect(alt.participation).toBe(300);
    // רק alternative אחת (לא נרשם רכב נוכחי כחלופה)
    expect(st!.scenarios.filter((s) => s.role === "alternative").length).toBe(1);

    // עיסוק/קבוצה/ילדים נקבעים בשיחה (updateCase) — *לא* מתלוש. התלוש נושא רק
    // שדות שכר. כך בפועל: המודל מעדכן עובדות משותפות דרך updateFacts, ואז מגיע תלוש.
    st = await service.getCaseState(caseId, owner);
    const upd = await service.updateFacts(caseId, owner, {
      qualifyingChildren: 0, occupationCode: "product_manager", reportedGroup: "ג",
    }, st!.case.factsRevision);
    expect(upd.status).toBe("ok");

    // 3) זרימת תלוש: יוצרים שורת upload במצב extracted, ואז applyPayslip.
    const up = await admin.query(
      "insert into payslip_uploads (case_id, stored_key, mime, size_bytes, original_name, status, storage_backend, extraction) values ($1,$2,'application/pdf',1024,'payslip.pdf','extracted','fs',$3::jsonb) returning id",
      [caseId, "k-" + randomUUID(), JSON.stringify({ baseSalary: 18500, commission: 0, bonus: 0 })],
    );
    const uploadId = up.rows[0].id as string;
    // לפני אישור: payslipStatus=extracted (חילוץ אינו עובדות מאושרות).
    st = await service.getCaseState(caseId, owner);
    expect(st!.payslipStatus).toBe("extracted");

    // אישור והחלה: רק שדות תלוש (שכר 18,500, עמלות 0, בונוס 0 — 0 הוא ערך אמיתי,
    // + שיעורי הפרשה ונק' זיכוי). התלוש *אינו* מעדכן עיסוק/קבוצה/ילדים (אלה נקבעו
    // בשיחה לעיל); ניסיון לעדכנם דרך החלת תלוש נדחה מכוון (PAYSLIP_FACT_KEYS).
    const applyRes = await service.applyPayslip(caseId, owner, uploadId, {
      baseSalary: 18500, commission: 0, bonus: 0,
      pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.75,
    } as never, st!.case.factsRevision);
    expect(applyRes.status).toBe("applied");

    // אחרי אישור: payslipStatus=applied, והעובדות כוללות עמלות/בונוס=0 (לא null).
    st = await service.getCaseState(caseId, owner);
    expect(st!.payslipStatus).toBe("applied");
    expect(st!.facts.baseSalary).toBe(18500);
    expect(st!.facts.commission).toBe(0);   // 0 הוחל, לא "חסר"
    expect(st!.facts.bonus).toBe(0);

    // 4) בקשת השוואה שנעצרה (מדמים pending) ואז השלמה אחרי שיש נתונים.
    await service.setPendingRequest(caseId, owner, { kind: "compare", mode: "explicit", vehicleCodes: ["CAR-10"] });
    st = await service.getCaseState(caseId, owner);
    expect(st!.case.pendingRequest).not.toBeNull();

    // ההשוואה דרך אותו כלי שהשיחה משתמשת בו (explicit: ATTO 3 מול הנוכחי).
    const cmpRes = await compareScenarios(service, ctx, {
      mode: "explicit",
      candidates: [{ label: "ATTO 3", route: "company_car", vehicleCode: "CAR-10", participation: 300, maintenanceAllowance: 0 }],
    });
    expect(cmpRes.status).toBe("success");

    // חישוב+שמירה של ההשוואה הראשית (כרטיס) מול baseline/alternative השמורים.
    await service.computeAndSaveComparison(caseId, owner);
    await service.setPendingRequest(caseId, owner, null); // הושלם -> ניקוי

    // 5) אימות מצב שמור של הכרטיס + ניקוי הבקשה הממתינה.
    st = await service.getCaseState(caseId, owner);
    expect(st!.case.pendingRequest).toBeNull();
    const card = st!.latestComparison!;
    expect(card).toBeTruthy();
    expect(Number(card.result.baseline.netDisplay)).toBe(11032);
    expect(Number(card.result.alternative.netDisplay)).toBe(11693);
    expect(card.result.netDeltaDisplay).toBe(661);
  });
});
