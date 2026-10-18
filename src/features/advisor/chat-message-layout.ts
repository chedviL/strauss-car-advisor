// src/features/advisor/chat-message-layout.ts
// פריסת הודעות השיחה, כקבועים טהורים (ניתנים לבדיקה בלי דפדפן).
//
// עיקרון: מעטפת יציבה, מעוגנת לצד ימין (תחילת השורה ב-RTL), ורוחבה אינו תלוי בתוכן.
// כך בזמן streaming תחילת המשפט נשארת במקומה והטקסט נוסף שמאלה ולשורות הבאות,
// במקום שבועה מצומצמת-לתוכן תצמח ותזיז את המשפט כולו.
//
// אסור: להפוך מחרוזות / לשנות סדר chunks / להשתמש ב-unicode-bidi: plaintext
// על הפסקה (הוא גורם לכיוון להיקבע לפי התו החזק הראשון, ולכן שורה שנפתחת בשם רכב
// באנגלית הייתה הופכת ל-LTR ומזיזה את היישור).

import type { CSSProperties } from "react";

/** תקרת רוחב לקריאה נוחה; מתחת לה המעטפת תופסת את כל רוחב אזור הקריאה. */
export const ASSISTANT_MAX_WIDTH = "100%";

/** שורת ההודעה: מעוגנת בימין (בהקשר RTL flex-start = ימין). */
export const rowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-start",
  direction: "rtl",
};

/** מעטפת העוזר: רוחב קבוע, לא מצומצם לתוכן, כיוון ויישור מפורשים. */
export const assistantEnvelopeStyle: CSSProperties = {
  width: ASSISTANT_MAX_WIDTH,
  maxWidth: ASSISTANT_MAX_WIDTH,
  minWidth: 0,
  direction: "rtl",
  textAlign: "right",
  unicodeBidi: "isolate",
  overflowWrap: "anywhere",
  background: "transparent",
};

/** בועת המשתמש/ת: נשארת מצומצמת לתוכן (אינה מוזרמת), מעוגנת בימין. */
export const userEnvelopeStyle: CSSProperties = {
  maxWidth: "88%",
  direction: "rtl",
  textAlign: "right",
  unicodeBidi: "isolate",
  overflowWrap: "anywhere",
};