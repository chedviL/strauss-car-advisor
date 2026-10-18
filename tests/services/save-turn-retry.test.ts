// tests/services/save-turn-retry.test.ts
// ניסיונות שמירה אוטומטיים מוגבלים (ללא מודל/רשת): כשל זמני -> התאוששות,
// כשל קבוע -> failed, ואותן הודעות/מזהים בכל ניסיון (אידמפוטנטי).
import { describe, it, expect, vi } from "vitest";
import { saveTurnWithRetry, type SaveRow, type SaveStatusData } from "../../src/server/web/save-turn.js";
import type { CaseService } from "../../src/server/services/case-service.js";

const rows: SaveRow[] = [
  { role: "user", clientMessageId: "u1", content: [{ type: "text", text: "שלום" }] },
  { role: "assistant", clientMessageId: "a1", content: [{ type: "text", text: "היי" }] },
];
const noSleep = () => Promise.resolve();

// service מדומה שסופר קריאות ל-appendMessages ומאפשר להכשיל N ניסיונות ראשונים.
function mockService(failFirst: number, capture?: SaveRow[][]): CaseService {
  let calls = 0;
  return {
    appendMessages: vi.fn(async (_caseId: string, _owner: string, msgs: SaveRow[]) => {
      calls += 1;
      capture?.push(msgs);
      if (calls <= failFirst) throw new Error(`transient #${calls}`);
    }),
  } as unknown as CaseService;
}

describe("saveTurnWithRetry: ניסיונות חוזרים אוטומטיים", () => {
  it("הצלחה בניסיון ראשון -> saving ואז saved, קריאה אחת בלבד", async () => {
    const svc = mockService(0);
    const statuses: SaveStatusData[] = [];
    const ok = await saveTurnWithRetry(svc, "c1", "o1", rows, (s) => statuses.push(s), "test", { sleep: noSleep });
    expect(ok).toBe(true);
    expect(statuses[0]!.phase).toBe("saving");
    expect((svc.appendMessages as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("כשל זמני ואז הצלחה -> retrying בחיווי, בסוף saved", async () => {
    const svc = mockService(2); // שני כשלונות ואז הצלחה בניסיון השלישי
    const statuses: SaveStatusData[] = [];
    const ok = await saveTurnWithRetry(svc, "c1", "o1", rows, (s) => statuses.push(s), "test", { sleep: noSleep });
    expect(ok).toBe(true);
    const phases = statuses.map((s) => s.phase);
    expect(phases[0]).toBe("saving");
    expect(phases).toContain("retrying"); // חיווי התאוששות שקט
    expect((svc.appendMessages as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3);
  });

  it("כל הניסיונות נכשלים -> מחזיר false (failed); לא מבטיחים שמירה", async () => {
    const svc = mockService(99); // תמיד נכשל
    const statuses: SaveStatusData[] = [];
    const ok = await saveTurnWithRetry(svc, "c1", "o1", rows, (s) => statuses.push(s), "test", { sleep: noSleep, maxAttempts: 4 });
    expect(ok).toBe(false);
    // 4 ניסיונות בדיוק (ראשון + 3 חוזרים)
    expect((svc.appendMessages as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(4);
    // חיווי retrying הופיע (ניסיון 2..4) אבל saved מעולם לא (זה נקבע ב-route לפי הערך המוחזר)
    expect(statuses.filter((s) => s.phase === "retrying").length).toBe(3);
  });

  it("אותן הודעות ואותם מזהים בכל ניסיון (אידמפוטנטי, בלי שינוי תוכן)", async () => {
    const capture: SaveRow[][] = [];
    const svc = mockService(2, capture);
    await saveTurnWithRetry(svc, "c1", "o1", rows, () => {}, "test", { sleep: noSleep });
    expect(capture).toHaveLength(3); // שלושה ניסיונות
    // כל ניסיון קיבל בדיוק את אותן שורות (אותם client_message_id ותוכן)
    for (const attemptRows of capture) {
      expect(attemptRows.map((r) => r.clientMessageId)).toEqual(["u1", "a1"]);
      expect(attemptRows).toEqual(rows);
    }
  });

  it("סדר ההשהיות עולה (backoff) ומוגבל למספר הניסיונות", async () => {
    const svc = mockService(99);
    const sleeps: number[] = [];
    const sleep = (ms: number) => { sleeps.push(ms); return Promise.resolve(); };
    await saveTurnWithRetry(svc, "c1", "o1", rows, () => {}, "test", { sleep, maxAttempts: 4, backoffMs: [10, 20, 40] });
    // 3 השהיות בין 4 ניסיונות, בסדר עולה
    expect(sleeps).toEqual([10, 20, 40]);
  });
});