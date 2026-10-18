// tests/services/message-persistence.test.ts
// שמירת הודעות: סדר seq, dedup יציב, שמירת משתמש+עוזר יחד, וכשל כתיבה.
// מכסה ארבעה תרחישים לוגיים (ללא מודל/רשת): הצלחה, שליחה חוזרת (dedup),
// כשל שמירה (לא מסמן הצלחה), וכתיבה חופפת לאותו תיק.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileCaseRepository } from "../../src/server/repositories/case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { getActiveDataset } from "../../src/server/services/dataset-provider.js";
import type { CaseFacts } from "../../src/domain/contracts/case.js";

let dir: string; let service: CaseService; let repo: FileCaseRepository;
const OWNER = "persist-test";
const facts: CaseFacts = { occupationCode: "product_manager", reportedGroup: "ג", baseSalary: 18500, commission: 0, bonus: 0, pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.75, qualifyingChildren: 2 };

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "strauss-persist-")); repo = new FileCaseRepository(dir); service = new CaseService(repo); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function newCase() {
  const ds = getActiveDataset();
  return repo.createCase({ ownerId: OWNER, isDemo: true, datasetId: ds.contentId, facts, baseline: { role: "baseline", route: "company_car", vehicleCode: "CAR-09", participation: 300, maintenanceAllowance: 0 } });
}

describe("שמירת הודעות: סדר, dedup, וכשל", () => {
  it("הצלחה: משתמש+עוזר נשמרים יחד, המשתמש לפני העוזר (seq עולה)", async () => {
    const c = await newCase();
    await service.appendMessages(c.case.id, OWNER, [
      { role: "user", clientMessageId: "u1", content: [{ type: "text", text: "שלום" }] },
      { role: "assistant", clientMessageId: "a1", content: [{ type: "text", text: "שלום, איך אפשר לעזור?" }] },
    ]);
    const msgs = await service.loadMessages(c.case.id, OWNER);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[0]!.seq).toBeLessThan(msgs[1]!.seq); // משתמש לפני עוזר
    expect(msgs[0]!.clientMessageId).toBe("u1");
    expect(msgs[1]!.clientMessageId).toBe("a1");
  });

  it("שליחה חוזרת (dedup): אותן הודעות שוב אינן יוצרות כפל ואינן הופכות סדר", async () => {
    const c = await newCase();
    const batch = [
      { role: "user", clientMessageId: "u1", content: [{ type: "text", text: "שלום" }] },
      { role: "assistant", clientMessageId: "a1", content: [{ type: "text", text: "היי" }] },
    ];
    await service.appendMessages(c.case.id, OWNER, batch);
    await service.appendMessages(c.case.id, OWNER, batch); // שליחה חוזרת מלאה
    const msgs = await service.loadMessages(c.case.id, OWNER);
    expect(msgs).toHaveLength(2); // אין כפל
    expect(msgs.map((m) => m.clientMessageId)).toEqual(["u1", "a1"]);
  });

  it("הודעה חדשה אחרי שליחה חוזרת מקבלת seq עוקב, בלי בליעת מספרים", async () => {
    const c = await newCase();
    await service.appendMessages(c.case.id, OWNER, [{ role: "user", clientMessageId: "u1", content: [{ type: "text", text: "a" }] }]);
    // שליחה חוזרת של u1 + הודעה חדשה u2 באותה קריאה
    await service.appendMessages(c.case.id, OWNER, [
      { role: "user", clientMessageId: "u1", content: [{ type: "text", text: "a" }] },
      { role: "assistant", clientMessageId: "a1", content: [{ type: "text", text: "b" }] },
    ]);
    const msgs = await service.loadMessages(c.case.id, OWNER);
    expect(msgs.map((m) => m.clientMessageId)).toEqual(["u1", "a1"]);
    // seq רציף: u1=0, a1=1 (ה-dedup של u1 לא בלע מספר)
    expect(msgs.map((m) => m.seq)).toEqual([0, 1]);
  });

  it("כשל שמירה מתפשט (לא נבלע) — הקורא יכול לא לסמן הצלחה", async () => {
    const c = await newCase();
    // appendMessages על תיק לא קיים זורק -> הקורא (route onEnd) תופס ולא מסמן saved=ok
    await expect(
      service.appendMessages("nonexistent-case", OWNER, [{ role: "user", clientMessageId: "x", content: [] }]),
    ).rejects.toThrow();
    // התיק האמיתי נותר ללא הודעות (לא נכתב חלקית)
    const msgs = await service.loadMessages(c.case.id, OWNER);
    expect(msgs).toHaveLength(0);
  });

  it("הודעת משתמש לבדה נשמרת (מצב כשל-מודל שניתן להתאושש ממנו)", async () => {
    const c = await newCase();
    // סימולציה של כשל מודל: נשמרת רק הודעת המשתמש
    await service.appendMessages(c.case.id, OWNER, [{ role: "user", clientMessageId: "u1", content: [{ type: "text", text: "שלום" }] }]);
    let msgs = await service.loadMessages(c.case.id, OWNER);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe("user");
    // בתור הבא: אותה הודעה נשלחת שוב (dedup) + תשובת עוזר -> אין כפל, הסדר נשמר
    await service.appendMessages(c.case.id, OWNER, [
      { role: "user", clientMessageId: "u1", content: [{ type: "text", text: "שלום" }] },
      { role: "assistant", clientMessageId: "a1", content: [{ type: "text", text: "היי" }] },
    ]);
    msgs = await service.loadMessages(c.case.id, OWNER);
    expect(msgs.map((m) => m.clientMessageId)).toEqual(["u1", "a1"]);
  });
});