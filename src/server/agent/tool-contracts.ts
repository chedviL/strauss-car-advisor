// src/server/agent/tool-contracts.ts
// מעטפת אחידה לכלים (design §4.1, §6). זהות מוזרקת מהשרת בלבד;
// המודל אינו קובע owner_id/תפקיד. סטטוסים סגורים; כספים כמחרוזת עשרונית; תאריכים ISO.

export type ToolStatus =
  | "success"
  | "missing_data"
  | "clarification_required"
  | "ineligible"
  | "conflict"
  | "retryable_error";

/** הקשר הכלי - מוזרק מהשרת (סשן/ביקור מאומת), לא מהמודל ולא מהלקוח. */
export interface ToolContext {
  ownerId: string;        // זהות הבעלים מהשרת (cookie ביקור בדמו, או auth.uid())
  caseId: string;         // התיק המאומת ששייך ל-ownerId
  staffRole: string | null;
  requestId: string;      // מזהה בקשה לאידמפוטנטיות
  messageId: string | null;
}

export interface ClarificationOption {
  id: string;
  label: string;
}

/** מעטפת תשובה אחידה לכל כלי. */
export interface ToolResult<T> {
  status: ToolStatus;
  data?: T;
  /** שדות חסרים לפעולה (status=missing_data). */
  requiredFields?: string[];
  /** אפשרויות הבהרה (status=clarification_required). */
  clarificationOptions?: ClarificationOption[];
  /** סיבות עסקיות מובנות (למשל ineligible). */
  reasons?: string[];
  /** גרסאות רלוונטיות (facts/scenario revisions). */
  versions?: Record<string, number>;
  /** הודעה קצרה בעברית להצגה/לוג (לא מקור עובדות כספיות). */
  message?: string;
}

export function ok<T>(data: T, extra?: Partial<ToolResult<T>>): ToolResult<T> {
  return { status: "success", data, ...extra };
}
export function missing<T>(requiredFields: string[], message?: string): ToolResult<T> {
  return { status: "missing_data", requiredFields, ...(message ? { message } : {}) };
}
export function clarify<T>(options: ClarificationOption[], message?: string): ToolResult<T> {
  return { status: "clarification_required", clarificationOptions: options, ...(message ? { message } : {}) };
}
export function ineligible<T>(reasons: string[], message?: string): ToolResult<T> {
  return { status: "ineligible", reasons, ...(message ? { message } : {}) };
}
export function conflict<T>(message: string, versions?: Record<string, number>): ToolResult<T> {
  return { status: "conflict", message, ...(versions ? { versions } : {}) };
}
export function retryable<T>(message: string): ToolResult<T> {
  return { status: "retryable_error", message };
}