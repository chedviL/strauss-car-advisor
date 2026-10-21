-- 0018_grant_delete_cases.sql
-- מחיקת שיחה ע"י המשתמש/ת: מתן הרשאת DELETE לתפקיד האפליקציה על טבלת cases.
-- המחיקה כפופה ל-RLS (cases_owner: owner_id = app.owner_id), כך שניתן למחוק רק
-- תיקים בבעלות המשתמש/ת. כל הטבלאות הבנות מוגדרות ON DELETE CASCADE ולכן נמחקות
-- אוטומטית (messages, scenarios, case_facts, comparisons, inquiries, compare_runs,
-- payslip_uploads, notification_jobs). אין צורך בהרשאת DELETE על הבנות - ה-CASCADE
-- מתבצע במסגרת מחיקת האב ואינו כפוף ל-grants של התפקיד המוחק.

grant delete on cases to strauss_app;
