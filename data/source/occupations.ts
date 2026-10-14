// data/source/occupations.ts
// 14 עיסוקים מגיליון "עיסוקים": קבוצת זכאות, רכב חובה, היתר ויתור, סכום אחזקה.

import type { Occupation } from "../../src/domain/eligibility/engine.js";

export const OCCUPATIONS: Occupation[] = [
  { code: "sales_field", name: "נציג/ת מכירות שטח", group: "ב", carMandatory: true, waiverAllowed: false, maintenanceAllowance: 0 },
  { code: "sales_area_manager", name: "מנהל/ת אזור מכירות", group: "ג", carMandatory: true, waiverAllowed: false, maintenanceAllowance: 0 },
  { code: "service_tech", name: "טכנאי/ת שירות", group: "א", carMandatory: true, waiverAllowed: false, maintenanceAllowance: 0 },
  { code: "distribution_driver", name: "נהג/ת הפצה", group: "א", carMandatory: true, waiverAllowed: false, maintenanceAllowance: 0 },
  { code: "qa_supervisor", name: "מפקח/ת איכות במפעל", group: "א", carMandatory: false, waiverAllowed: true, maintenanceAllowance: 1200 },
  { code: "procurement", name: "רכז/ת רכש", group: "א", carMandatory: false, waiverAllowed: true, maintenanceAllowance: 1200 },
  { code: "process_engineer", name: "מהנדס/ת תהליך", group: "ב", carMandatory: false, waiverAllowed: true, maintenanceAllowance: 1500 },
  { code: "developer", name: "מפתח/ת תוכנה", group: "ב", carMandatory: false, waiverAllowed: true, maintenanceAllowance: 1500 },
  { code: "data_analyst", name: "אנליסט/ית נתונים", group: "ב", carMandatory: false, waiverAllowed: true, maintenanceAllowance: 1500 },
  { code: "product_manager", name: "מנהל/ת מוצר", group: "ג", carMandatory: false, waiverAllowed: true, maintenanceAllowance: 2000 },
  { code: "dev_manager", name: "מנהל/ת פיתוח", group: "ג", carMandatory: false, waiverAllowed: true, maintenanceAllowance: 2000 },
  { code: "hr_manager", name: "מנהל/ת משאבי אנוש", group: "ג", carMandatory: false, waiverAllowed: true, maintenanceAllowance: 2000 },
  { code: "dept_manager", name: "מנהל/ת מחלקה", group: "ד", carMandatory: false, waiverAllowed: true, maintenanceAllowance: 2600 },
  { code: "division_manager", name: "מנהל/ת חטיבה", group: "ד", carMandatory: false, waiverAllowed: true, maintenanceAllowance: 3000 },
];

export function findOccupation(code: string | null): Occupation | undefined {
  if (!code) return undefined;
  return OCCUPATIONS.find((o) => o.code === code);
}