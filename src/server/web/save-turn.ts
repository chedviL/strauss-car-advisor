// src/server/web/save-turn.ts
// שמירת תור שיחה עם ניסיונות חוזרים אוטומטיים ומוגבלים (backoff).
// השמירה היא באחריות המערכת: רק ה-appendMessages חוזר - לא המודל/חישוב/כלים.
// ה-appendMessages אידמפוטנטי (dedup לפי client_message_id) -> ניסיון חוזר
// לאותן הודעות ואותם מזהים בטוח ואינו יוצר כפל. לא מבטיחים שמירה אם נכשלה.

import type { CaseService } from "../services/case-service.js";

export type SavePhase = "saving" | "retrying" | "saved" | "failed";
export type SaveStatusData = { phase: SavePhase; attempt?: number; scope: "turn" };

export type SaveRow = { role: "user" | "assistant"; clientMessageId: string | null; content: unknown };

export interface SaveRetryOptions {
  maxAttempts?: number;      // ברירת מחדל 4 (ראשון + 3 חוזרים)
  backoffMs?: number[];      // השהיות בין ניסיונות
  sleep?: (ms: number) => Promise<void>; // ניתן-להזרקה לבדיקות (בלי המתנה אמיתית)
  log?: (line: string) => void;
}

const DEFAULT_BACKOFF = [250, 750, 1500];

export async function saveTurnWithRetry(
  service: CaseService,
  caseId: string,
  owner: string,
  rows: SaveRow[],
  emit: (status: SaveStatusData) => void,
  logTag: string,
  opts: SaveRetryOptions = {},
): Promise<boolean> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? ((l: string) => console.warn(l));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    emit({ phase: attempt === 1 ? "saving" : "retrying", ...(attempt > 1 ? { attempt } : {}), scope: "turn" });
    try {
      await service.appendMessages(caseId, owner, rows);
      if (attempt > 1) log(`[measure] ${logTag} turn-save recovered attempt=${attempt}`);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const willRetry = attempt < maxAttempts;
      log(`[measure] ${logTag} turn-save attempt=${attempt} FAILED (${msg}) ${willRetry ? "will-retry" : "giving-up"}`);
      if (!willRetry) return false;
      await sleep(backoff[attempt - 1] ?? backoff[backoff.length - 1] ?? 1500);
    }
  }
  return false;
}