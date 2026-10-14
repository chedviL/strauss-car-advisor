// tests/integration/pg-rls.test.ts
// בדיקות אינטגרציה מול Postgres (Supabase): RLS, בידוד, שחזור, מקביליות.
// רצות רק כאשר DATABASE_URL מוגדר (תפקיד האפליקציה המוגבל); אחרת skipped.
// זהו האימות היחיד שנחשב כאימות Postgres - אחסון קבצים אינו תחליף.
//
// חשוב: DATABASE_URL צריך להצביע על תפקיד האפליקציה (strauss_app) הכפוף ל-RLS,
// נפרד מ-MIGRATION_DATABASE_URL (בעלים) שמריץ מיגרציות.

import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { PgCaseRepository } from "../../src/server/repositories/pg-case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import type { CaseFacts, CaseState } from "../../src/domain/contracts/case.js";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATION_URL = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

const demoFacts: CaseFacts = {
  occupationCode: "product_manager", reportedGroup: "ג", baseSalary: 18500,
  commission: 0, bonus: 0, pensionRate: 0.06, trainingRate: 0.025,
  creditPoints: 2.75, qualifyingChildren: 2,
};

run("Postgres RLS + בידוד + שחזור + מקביליות", () => {
  let repo: PgCaseRepository;
  let service: CaseService;
  let datasetId: string;
  let admin: Client; // תפקיד בעלים/אדמין ל-seed בלבד

  beforeAll(async () => {
    admin = new Client({ connectionString: MIGRATION_URL });
    await admin.connect();
    const rs = await admin.query(
      `insert into rule_sets (version, content_hash, config)
       values ('test', $1, '{}'::jsonb)
       on conflict (content_hash) do update set version = excluded.version
       returning id`,
      ["test-hash-" + randomUUID()],
    );
    const ds = await admin.query(
      `insert into datasets (rule_set_id, value_of_use_source, value_of_use_row_count)
       values ($1, 'test', 0) returning id`,
      [rs.rows[0].id],
    );
    datasetId = ds.rows[0].id;
    repo = new PgCaseRepository(DATABASE_URL!);
    service = new CaseService(repo);
  });

  afterAll(async () => {
    if (admin) {
      await admin.query("delete from cases where dataset_id = $1", [datasetId]).catch(() => {});
      await admin.end();
    }
    if (repo) await repo.close();
  });

  async function createCase(owner: string): Promise<CaseState> {
    return repo.createCase({
      ownerId: owner, isDemo: true, datasetId, facts: demoFacts,
      baseline: { role: "baseline", route: "company_car", vehicleCode: "CAR-09", participation: 300, maintenanceAllowance: 0 },
    });
  }

  it("שחזור: תיק שנשמר נטען חזרה עם baseline", async () => {
    const owner = "pg-visit-" + randomUUID();
    const created = await createCase(owner);
    const loaded = await repo.getCaseState(created.case.id, owner);
    expect(loaded).not.toBeNull();
    expect(loaded!.scenarios.some((s) => s.role === "baseline")).toBe(true);
  });

  it("RLS בידוד קריאה דרך ה-repository: owner אחר → null", async () => {
    const ownerA = "pg-A-" + randomUUID();
    const ownerB = "pg-B-" + randomUUID();
    const caseA = await createCase(ownerA);
    expect(await repo.getCaseState(caseA.case.id, ownerB)).toBeNull();
    expect(await repo.getCaseState(caseA.case.id, ownerA)).not.toBeNull();
  });

  it("RLS ברמת המסד: select גולמי ללא סינון בעלות על תיק של אחר → 0 שורות", async () => {
    // הבדיקה המכרעת: תחת תפקיד האפליקציה, עם app.owner_id של ב', שאילתה
    // גולמית ללא where על owner אינה רואה את התיק של א'. המסד חוסם, לא ה-WHERE.
    const ownerA = "pg-raw-A-" + randomUUID();
    const ownerB = "pg-raw-B-" + randomUUID();
    const caseA = await createCase(ownerA);

    const appClient = new Client({ connectionString: DATABASE_URL });
    await appClient.connect();
    try {
      await appClient.query("begin");
      await appClient.query("select set_config('app.owner_id', $1, true)", [ownerB]);
      const byId = await appClient.query("select * from cases where id = $1", [caseA.case.id]);
      expect(byId.rowCount).toBe(0);
      const all = await appClient.query("select id from cases");
      expect(all.rows.map((x) => x.id)).not.toContain(caseA.case.id);
      await appClient.query("commit");
    } finally {
      await appClient.end();
    }
  });

  it("תפקיד האפליקציה strauss_app אינו רשאי BYPASSRLS", async () => {
    const appRole = await admin.query(
      "select rolbypassrls, rolsuper from pg_roles where rolname = 'strauss_app'",
    );
    // אם התפקיד קיים (מיגרציה 0002 הורצה), הוא חייב להיות ללא bypassrls וללא superuser.
    if (appRole.rowCount && appRole.rows[0]) {
      expect(appRole.rows[0].rolbypassrls).toBe(false);
      expect(appRole.rows[0].rolsuper).toBe(false);
    }
  });

  it("RLS בידוד כתיבה: owner אחר אינו יכול להוסיף חלופה", async () => {
    const ownerA = "pg-WA-" + randomUUID();
    const ownerB = "pg-WB-" + randomUUID();
    const caseA = await createCase(ownerA);
    await expect(
      repo.upsertAlternative(caseA.case.id, ownerB, {
        role: "alternative", route: "company_car", vehicleCode: "CAR-10",
        participation: 300, maintenanceAllowance: 0,
      }),
    ).rejects.toThrow();
  });

  it("אילוץ baseline יחיד: לא ניתן להכניס baseline שני לאותו תיק", async () => {
    const owner = "pg-base-" + randomUUID();
    const caseA = await createCase(owner);
    await expect(
      admin.query(
        `insert into scenarios (id, case_id, role, route, maintenance_allowance, revision)
         values ($1,$2,'baseline','company_car',0,0)`,
        [randomUUID(), caseA.case.id],
      ),
    ).rejects.toThrow();
  });

  it("חישוב מלא מול Postgres: E-001 נטו 11032→11693", async () => {
    const owner = "pg-calc-" + randomUUID();
    const created = await service.createDemoCaseFromEmployee(owner, "E-001");
    await service.pickAlternative(created.case.id, owner, {
      role: "alternative", route: "company_car", vehicleCode: "CAR-10",
      participation: 300, maintenanceAllowance: 0,
    });
    const res = await service.computeAndSaveComparison(created.case.id, owner);
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(Number(res.comparison.result.baseline.netDisplay)).toBe(11032);
      expect(res.comparison.result.netDeltaDisplay).toBe(661);
    }
    await admin.query("delete from cases where id = $1", [created.case.id]);
  });

  it("override תרחיש נשמר ונטען תחת תפקיד האפליקציה (migration 0003)", async () => {
    const owner = "pg-ov-" + randomUUID();
    const created = await createCase(owner);
    await repo.upsertAlternative(created.case.id, owner, {
      role: "alternative", route: "company_car", vehicleCode: "CAR-10",
      participation: 300, maintenanceAllowance: 0, overrides: { baseSalary: 25000 },
    });
    const state = await repo.getCaseState(created.case.id, owner);
    const alt = state!.scenarios.find((s) => s.role === "alternative")!;
    expect(alt.overrides.baseSalary).toBe(25000);
    const baseline = state!.scenarios.find((s) => s.role === "baseline")!;
    expect(baseline.overrides.baseSalary).toBeUndefined();
  });

  it("updateFacts תחת RLS: בדיקת גרסה מחזירה conflict (migration תקין)", async () => {
    const owner = "pg-uf-" + randomUUID();
    const created = await createCase(owner);
    const r1 = await repo.updateFacts(created.case.id, owner, { baseSalary: 20000 }, 0);
    expect(r1.status).toBe("ok");
    const stale = await repo.updateFacts(created.case.id, owner, { baseSalary: 99999 }, 0);
    expect(stale.status).toBe("conflict");
  });

  it("openInquiry dedup תחת RLS + אינדקס ייחודי (migration 0004)", async () => {
    const owner = "pg-inq-" + randomUUID();
    const created = await createCase(owner);
    const a = await repo.openInquiry(created.case.id, owner, {
      type: "employee_participation", scenarioId: null, contextFingerprint: "ctx-1",
    });
    const b = await repo.openInquiry(created.case.id, owner, {
      type: "employee_participation", scenarioId: null, contextFingerprint: "ctx-1",
    });
    expect(a.deduped).toBe(false);
    expect(b.deduped).toBe(true);
    expect(b.inquiry.id).toBe(a.inquiry.id);
    const state = await repo.getCaseState(created.case.id, owner);
    expect(state!.openInquiries.length).toBe(1);
  });

  it("בידוד inquiries: owner אחר אינו רואה פנייה של אחר (RLS)", async () => {
    const ownerA = "pg-inqA-" + randomUUID();
    const ownerB = "pg-inqB-" + randomUUID();
    const caseA = await createCase(ownerA);
    await repo.openInquiry(caseA.case.id, ownerA, {
      type: "employee_participation", scenarioId: null, contextFingerprint: "x",
    });
    const asB = await repo.getCaseState(caseA.case.id, ownerB);
    expect(asB).toBeNull();
  });

  it("מקביליות: שתי הוספות חלופה במקביל אינן יוצרות כפילות", async () => {
    const owner = "pg-conc-" + randomUUID();
    const created = await createCase(owner);
    const alt = (code: string) =>
      repo.upsertAlternative(created.case.id, owner, {
        role: "alternative", route: "company_car", vehicleCode: code,
        participation: 300, maintenanceAllowance: 0,
      });
    await Promise.allSettled([alt("CAR-10"), alt("CAR-11")]);
    const state = await repo.getCaseState(created.case.id, owner);
    expect(state!.scenarios.filter((s) => s.role === "alternative").length).toBeLessThanOrEqual(1);
  });
});

describe("סטטוס בדיקות Postgres", () => {
  it(DATABASE_URL ? "DATABASE_URL מוגדר - בדיקות RLS רצות" : "DATABASE_URL חסר - בדיקות RLS ממתינות (skipped)", () => {
    expect(true).toBe(true);
  });
});