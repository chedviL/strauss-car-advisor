// data/source/sample-employees.ts
// ששת העובדים לדוגמה לסביבת הדגמה (מגיליון "עובדים לדוגמה").
// כל עובד ממופה לעובדות + baseline (המצב הנוכחי שלו).

import type { RouteKind } from "../../src/domain/contracts/types.js";

export interface SampleEmployee {
  id: string;
  name: string;
  occupationName: string;
  group: string;
  question: string;
  facts: {
    occupationCode: string;
    reportedGroup: string;
    baseSalary: number;
    commission: number;
    bonus: number;
    pensionRate: number;
    trainingRate: number;
    creditPoints: number;
    qualifyingChildren: number;
  };
  baseline: {
    route: RouteKind;
    vehicleCode: string | null; // קוד קטלוג, או null בוויתור
    participation: number | null;
    maintenanceAllowance: number;
    label: string;
  };
  /** חלופה מוצעת (לכפתור "הצג חלופה" בחתך הראשון). */
  suggestedAlternative: {
    route: RouteKind;
    vehicleCode: string | null;
    participation: number | null;
    maintenanceAllowance: number;
    label: string;
  };
}

export const SAMPLE_EMPLOYEES: SampleEmployee[] = [
  {
    id: "E-001", name: "נועה לוי", occupationName: "מנהלת מוצר", group: "ג",
    question: "אם אעבור מהקורולה קרוס ל-BYD Atto 3 החשמלי - כמה זה ישנה לי בנטו?",
    facts: { occupationCode: "product_manager", reportedGroup: "ג", baseSalary: 18500, commission: 0, bonus: 0, pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.75, qualifyingChildren: 2 },
    baseline: { route: "company_car", vehicleCode: "CAR-09", participation: 300, maintenanceAllowance: 0, label: "COROLLA CROSS" },
    suggestedAlternative: { route: "company_car", vehicleCode: "CAR-10", participation: 300, maintenanceAllowance: 0, label: "ATTO 3 חשמלי" },
  },
  {
    id: "E-002", name: "דוד כהן", occupationName: "נציג מכירות שטח", group: "ב",
    question: "יש לי 5 ילדים. אם אקח קרניבל במסלול ברוכי ילדים - מה יקרה לנטו?",
    facts: { occupationCode: "sales_field", reportedGroup: "ב", baseSalary: 9800, commission: 2400, bonus: 0, pensionRate: 0.06, trainingRate: 0, creditPoints: 2.25, qualifyingChildren: 5 },
    baseline: { route: "company_car", vehicleCode: "CAR-05", participation: 250, maintenanceAllowance: 0, label: "NIRO" },
    suggestedAlternative: { route: "family", vehicleCode: "CAR-19", participation: 500, maintenanceAllowance: 0, label: "CARNIVAL (משפחתי)" },
  },
  {
    id: "E-003", name: "רחל פרידמן", occupationName: "מפתחת תוכנה", group: "ב",
    question: "היום אני מקבלת אחזקת רכב. אם אקח MG4 חשמלי - כמה אפסיד או ארוויח בנטו?",
    facts: { occupationCode: "developer", reportedGroup: "ב", baseSalary: 21000, commission: 0, bonus: 0, pensionRate: 0.065, trainingRate: 0.025, creditPoints: 2.75, qualifyingChildren: 0 },
    baseline: { route: "waiver", vehicleCode: null, participation: 0, maintenanceAllowance: 1500, label: "ויתור - אחזקה 1,500 ₪" },
    suggestedAlternative: { route: "company_car", vehicleCode: "CAR-06", participation: 250, maintenanceAllowance: 0, label: "MG4 חשמלי" },
  },
  {
    id: "E-004", name: "יוסי מזרחי", occupationName: "מנהל אזור מכירות", group: "ג",
    question: "אם אחליף את הטוסון ב-EV3 - מה ההפרש בנטו?",
    facts: { occupationCode: "sales_area_manager", reportedGroup: "ג", baseSalary: 16000, commission: 3000, bonus: 0, pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.25, qualifyingChildren: 3 },
    baseline: { route: "company_car", vehicleCode: "CAR-12", participation: 400, maintenanceAllowance: 0, label: "TUCSON" },
    suggestedAlternative: { route: "company_car", vehicleCode: "CAR-11", participation: 300, maintenanceAllowance: 0, label: "EV3 חשמלי" },
  },
  {
    id: "E-005", name: "מיכל אברהם", occupationName: "מנהלת פיתוח", group: "ג",
    question: "אם אוותר על הרכב ואקבל אחזקה - כמה אקבל בנטו?",
    facts: { occupationCode: "dev_manager", reportedGroup: "ג", baseSalary: 27000, commission: 0, bonus: 0, pensionRate: 0.07, trainingRate: 0.025, creditPoints: 2.75, qualifyingChildren: 1 },
    baseline: { route: "company_car", vehicleCode: "CAR-13", participation: 350, maintenanceAllowance: 0, label: "MAZDA 3" },
    suggestedAlternative: { route: "waiver", vehicleCode: null, participation: 0, maintenanceAllowance: 2000, label: "ויתור - אחזקה 2,000 ₪" },
  },
  {
    id: "E-006", name: "אלי שמעון", occupationName: "מנהל מחלקה", group: "ד",
    question: "אם אעבור מהאוקטביה לטסלה מודל 3 - מה יקרה לנטו?",
    facts: { occupationCode: "dept_manager", reportedGroup: "ד", baseSalary: 32000, commission: 0, bonus: 2000, pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.25, qualifyingChildren: 4 },
    baseline: { route: "company_car", vehicleCode: "CAR-15", participation: 500, maintenanceAllowance: 0, label: "OCTAVIA" },
    suggestedAlternative: { route: "company_car", vehicleCode: "CAR-14", participation: 500, maintenanceAllowance: 0, label: "MODEL 3 חשמלי" },
  },
];