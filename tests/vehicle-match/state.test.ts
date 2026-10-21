// tests/vehicle-match/state.test.ts
// בידוד מצב השאלון בין משתמשים ובירורים, ניקוי ביציאה, והכנת טיוטה בלי דריסה/שליחה.

import { describe, it, expect } from "vitest";
import {
  STORAGE_PREFIX, clearAllMatchState, clearNewScopeState, comparePrompt, INITIAL_STATE, loadMatchState,
  moveMatchState, planPrefill, saveMatchState, scopeKey, type PersistedMatchState,
} from "../../src/features/advisor/vehicle-match/match-state.js";

class FakeStorage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
}

const withAnswers = (priority: "net" | "cargo"): PersistedMatchState => ({
  ...INITIAL_STATE, view: "questions", step: 2,
  answers: { passengers: "three_five", seatsMin: null, cargo: "stroller", trips: null, charging: null, priority },
});

describe("בידוד מצב בין משתמשים ובירורים", () => {
  it("מפתחות נפרדים לכל משתמש/ת ולכל בירור", () => {
    const keys = new Set([scopeKey("u1", "c1"), scopeKey("u1", "c2"), scopeKey("u2", "c1"), scopeKey("u1", null)]);
    expect(keys.size).toBe(4);
  });

  it("שמירה וטעינה באותו בירור משחזרות תשובות; בירור/משתמש אחר לא רואה אותן", () => {
    const s = new FakeStorage();
    saveMatchState(s, scopeKey("u1", "c1"), withAnswers("net"));
    expect(loadMatchState(s, scopeKey("u1", "c1"))?.answers.cargo).toBe("stroller");
    expect(loadMatchState(s, scopeKey("u1", "c2"))).toBeNull();
    expect(loadMatchState(s, scopeKey("u2", "c1"))).toBeNull();
  });

  it("נתון פגום/לא תקין אינו נטען", () => {
    const s = new FakeStorage();
    s.setItem(scopeKey("u1", "c1"), "{not json");
    expect(loadMatchState(s, scopeKey("u1", "c1"))).toBeNull();
    s.setItem(scopeKey("u1", "c1"), JSON.stringify({ v: 1, view: "hack", step: 9 }));
    expect(loadMatchState(s, scopeKey("u1", "c1"))).toBeNull();
  });

  it("לא נשמרים שכר/נטו/תוצאות - רק העדפות", () => {
    const s = new FakeStorage();
    saveMatchState(s, scopeKey("u1", "c1"), withAnswers("cargo"));
    const raw = s.getItem(scopeKey("u1", "c1"))!;
    expect(raw).not.toMatch(/salary|baseSalary|netDelta|result/);
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["answers", "groupChoice", "step", "v", "view"]);
  });

  it("יציאה מנקה את כל המצב האישי (כל המשתמשים והבירורים) ולא נוגעת במפתחות אחרים", () => {
    const s = new FakeStorage();
    saveMatchState(s, scopeKey("u1", "c1"), withAnswers("net"));
    saveMatchState(s, scopeKey("u2", null), withAnswers("cargo"));
    s.setItem("a11y-settings-v1", "{}");
    expect(clearAllMatchState(s)).toBe(2);
    expect(loadMatchState(s, scopeKey("u1", "c1"))).toBeNull();
    expect(loadMatchState(s, scopeKey("u2", null))).toBeNull();
    expect(s.getItem("a11y-settings-v1")).toBe("{}");
    expect([...Array(s.length).keys()].every((i) => !s.key(i)!.startsWith(STORAGE_PREFIX))).toBe(true);
  });

  it("'שיחה חדשה' מנקה רק מצב של שיחות חדשות (new) ולא של בירורים קיימים", () => {
    const s = new FakeStorage();
    saveMatchState(s, scopeKey("u1", null), withAnswers("net"));
    saveMatchState(s, scopeKey("u1", "c1"), withAnswers("cargo"));
    expect(clearNewScopeState(s)).toBe(1);
    expect(loadMatchState(s, scopeKey("u1", null))).toBeNull();
    expect(loadMatchState(s, scopeKey("u1", "c1"))).not.toBeNull();
  });

  it("מעבר משיחה חדשה לבירור שנפתח לה מעביר את המצב, ואינו דורס מצב קיים של הבירור", () => {
    const s = new FakeStorage();
    saveMatchState(s, scopeKey("u1", null), withAnswers("net"));
    moveMatchState(s, scopeKey("u1", null), scopeKey("u1", "c9"));
    expect(loadMatchState(s, scopeKey("u1", null))).toBeNull();
    expect(loadMatchState(s, scopeKey("u1", "c9"))?.answers.priority).toBe("net");

    saveMatchState(s, scopeKey("u1", null), withAnswers("cargo"));
    moveMatchState(s, scopeKey("u1", null), scopeKey("u1", "c9"));
    expect(loadMatchState(s, scopeKey("u1", "c9"))?.answers.priority).toBe("net");
    expect(loadMatchState(s, scopeKey("u1", null))).toBeNull();
  });
});

describe("הכנת בקשת השוואה בתיבת ההקלדה", () => {
  it("הנוסח כולל את שם הרכב", () => {
    expect(comparePrompt("ATTO 3")).toBe("אשמח להשוות את ATTO 3 לרכב הנוכחי שלי.");
  });

  it("תיבה ריקה (או רווחים בלבד) -> מציבים את הטקסט", () => {
    expect(planPrefill("", "x")).toEqual({ kind: "set", text: "x" });
    expect(planPrefill("   \n", "x")).toEqual({ kind: "set", text: "x" });
  });

  it("טיוטה קיימת אינה נדרסת: מבקשים החלטה ושומרים את הטיוטה", () => {
    const plan = planPrefill("אני רוצה לברר משהו אחר", "x");
    expect(plan).toEqual({ kind: "ask", draft: "אני רוצה לברר משהו אחר", proposed: "x" });
  });
});
