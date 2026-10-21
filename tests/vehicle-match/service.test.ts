// tests/vehicle-match/service.test.ts
// תזמור בצד שרת מול CaseService אמיתי (file repo): בעלות, נטו מהמנוע הקיים, חוסר שכר,
// והוכחה שהתצוגה אינה משנה baseline/חלופה/השוואה או שולחת הודעה.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileCaseRepository } from "../../src/server/repositories/case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { executeVehicleMatch } from "../../src/server/services/vehicle-match-service.js";
import { ANSWERS } from "./helpers.js";

let dir: string;
let service: CaseService;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "strauss-vm-"));
  service = new CaseService(new FileCaseRepository(dir));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const payload = (over: Record<string, unknown> = {}) => ({
  answers: { ...ANSWERS, priority: "net" }, caseId: null, groupOverride: null, saveGroup: false, ...over,
});

describe("executeVehicleMatch", () => {
  it("קלט לא תקין נדחה", async () => {
    expect((await executeVehicleMatch(service, "u", { answers: {} })).status).toBe("invalid");
    expect((await executeVehicleMatch(service, "u", payload({ answers: { ...ANSWERS, passengers: "many", seatsMin: null } }))).status).toBe("invalid");
    expect((await executeVehicleMatch(service, "u", payload({ caseId: "not-a-uuid" }))).status).toBe("invalid");
  });

  it("בלי תיק ובלי קבוצה: מבקשים קבוצה; עם קבוצה שנמסרה: ממשיכים בלי נטו", async () => {
    const need = await executeVehicleMatch(service, "u", payload());
    expect(need.status === "ok" && need.result.status).toBe("needs_eligibility_group");

    const ok = await executeVehicleMatch(service, "u", payload({ groupOverride: "א" }));
    expect(ok.status).toBe("ok");
    if (ok.status === "ok") {
      expect(ok.hasCase).toBe(false);
      expect(ok.groupSource).toBe("override");
      expect(ok.groupSaved).toBe(false);
      expect(ok.result.netState).toBe("needs_details");
      for (const o of ok.result.options) expect(o.net.status).toBe("unavailable");
    }
  });

  it("תיק של עובדת עם שכר: נטו מהמנוע הקיים (CAR-10: +661 ₪ מול COROLLA CROSS)", async () => {
    const owner = "owner-1";
    const state = await service.createDemoCaseFromEmployee(owner, "E-001");
    const preview = await service.previewNetForCatalog(state);
    expect(preview.baselineName).toBe("COROLLA CROSS");
    const atto = preview.byVehicle["CAR-10"]!;
    expect(atto.status === "ok" && atto.netDelta).toBe(661);

    const res = await executeVehicleMatch(service, owner, payload({ caseId: state.case.id }));
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.hasCase).toBe(true);
      expect(res.groupSource).toBe("occupation");
      expect(res.result.netState).toBe("available");
      expect(res.result.rankingBasis).toBe("net");
      const deltas = res.result.options.map((o) => (o.net.status === "ok" ? o.net.netDelta : null));
      expect(deltas.every((d) => d !== null)).toBe(true);
      expect([...deltas].sort((a, b) => b! - a!)).toEqual(deltas);
    }
  });

  it("התצוגה אינה משנה baseline, חלופה, השוואה או גרסת עובדות", async () => {
    const owner = "owner-2";
    const created = await service.createDemoCaseFromEmployee(owner, "E-001");
    await service.pickAlternative(created.case.id, owner, {
      role: "alternative", route: "company_car", vehicleCode: "CAR-10", participation: 300, maintenanceAllowance: 0,
    });
    await service.computeAndSaveComparison(created.case.id, owner);
    const before = JSON.stringify(await service.getCaseState(created.case.id, owner));
    const msgsBefore = (await service.loadMessages(created.case.id, owner)).length;

    for (const priority of ["net", "cargo", "compact", "balanced"]) {
      await executeVehicleMatch(service, owner, payload({ caseId: created.case.id, answers: { ...ANSWERS, priority } }));
    }
    const after = JSON.stringify(await service.getCaseState(created.case.id, owner));
    expect(after).toBe(before);
    expect((await service.loadMessages(created.case.id, owner)).length).toBe(msgsBefore);
  });

  it("חוסר שכר: ההתאמה פועלת אך אין נטו ואין השלמה בערכי דוגמה", async () => {
    const owner = "owner-3";
    const blank = await service.startBlankCase(owner);
    const set = await service.updateFacts(blank.case.id, owner, { reportedGroup: "ג" }, blank.case.factsRevision);
    expect(set.status).not.toBe("conflict");
    const res = await executeVehicleMatch(service, owner, payload({ caseId: blank.case.id }));
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.result.options.length).toBeGreaterThan(0);
      expect(res.result.netState).toBe("needs_details");
      for (const o of res.result.options) expect(o.net.status).toBe("unavailable");
    }
    const facts = (await service.getCaseState(blank.case.id, owner))!.facts;
    expect(facts.baseSalary).toBeNull();
    expect(facts.commission).toBeNull();
    expect(facts.bonus).toBeNull();
  });

  it("בידוד בין משתמשים: מזהה תיק של אחר מתנהג כמו 'אין תיק' ואינו דולף נתונים", async () => {
    const stateA = await service.createDemoCaseFromEmployee("owner-A", "E-001");
    const res = await executeVehicleMatch(service, "owner-B", payload({ caseId: stateA.case.id, groupOverride: "ב" }));
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.hasCase).toBe(false);
      expect(res.groupSource).toBe("override");
      expect(JSON.stringify(res.result)).not.toContain("COROLLA CROSS");
      for (const o of res.result.options) expect(o.net.status).toBe("unavailable");
    }
    // ואינו כותב לתיק של A
    expect((await service.getCaseState(stateA.case.id, "owner-A"))!.facts.reportedGroup).toBe("ג");
  });

  it("קבוצה שנמסרה נשמרת בתיק רק כשהתבקשה שמירה מפורשת ורק אם חסרה", async () => {
    const owner = "owner-4";
    const blank = await service.startBlankCase(owner);
    await executeVehicleMatch(service, owner, payload({ caseId: blank.case.id, groupOverride: "ב", saveGroup: false }));
    expect((await service.getCaseState(blank.case.id, owner))!.facts.reportedGroup).toBeNull();

    const saved = await executeVehicleMatch(service, owner, payload({ caseId: blank.case.id, groupOverride: "ב", saveGroup: true }));
    expect(saved.status === "ok" && saved.groupSaved).toBe(true);
    expect((await service.getCaseState(blank.case.id, owner))!.facts.reportedGroup).toBe("ב");

    // עובדת עם עיסוק מוכר: הקבוצה נקבעת מהעיסוק, ושליחת override אינה כותבת
    const emp = await service.createDemoCaseFromEmployee(owner, "E-001");
    const before = emp.case.factsRevision;
    const r = await executeVehicleMatch(service, owner, payload({ caseId: emp.case.id, groupOverride: "א", saveGroup: true }));
    expect(r.status === "ok" && r.groupSaved).toBe(false);
    expect((await service.getCaseState(emp.case.id, owner))!.case.factsRevision).toBe(before);
  });
});
