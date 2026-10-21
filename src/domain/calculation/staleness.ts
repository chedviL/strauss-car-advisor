// src/domain/calculation/staleness.ts
// האם ההשוואה האחרונה עדיין משקפת את מצב התיק. טהור (ללא Next/DB) כדי שישמש שרת, סוכן ו-UI.
// השוואה מיושנת כש:
//  - גרסת העובדות השתנתה מאז החישוב; או
//  - ה-baseline / החלופה שבהם חושבה השתנו (גרסת תרחיש שונה, או התרחיש נמחק/הוחלף).
// בדיקה לפי גרסת עובדות בלבד פספסה שינוי רכב נוכחי/השתתפות/סימולציה ("עדכנית" שגויה).

import type { CaseState } from "../contracts/case.js";

interface SnapshotScenario { id?: unknown; revision?: unknown }

function snapshotOf(raw: unknown): { id: string; revision: number } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as SnapshotScenario;
  if (typeof s.id !== "string" || typeof s.revision !== "number") return null;
  return { id: s.id, revision: s.revision };
}

export function isComparisonStale(state: Pick<CaseState, "case" | "scenarios" | "latestComparison">): boolean {
  const cmp = state.latestComparison;
  if (!cmp) return false;
  if (cmp.factsRevision !== state.case.factsRevision) return true;
  for (const [key, id] of [
    ["baseline", cmp.baselineScenarioId],
    ["alternative", cmp.alternativeScenarioId],
  ] as const) {
    const current = state.scenarios.find((s) => s.id === id);
    const snap = snapshotOf((cmp.inputSnapshot as Record<string, unknown> | null | undefined)?.[key]);
    if (!snap) continue; // אין תצלום תרחיש (נתון ישן/חסר): נשארים עם בדיקת גרסת העובדות בלבד
    if (!current) return true; // התרחיש שבו חושבה ההשוואה כבר אינו קיים
    if (snap.id === current.id && snap.revision !== current.revision) return true;
  }
  return false;
}
