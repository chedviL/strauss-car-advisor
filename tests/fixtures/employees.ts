// tests/fixtures/employees.ts
// ששת העובדים לדוגמה + ערכי הנטו הייחוסיים מגיליון "חישובים".
// ערכי expected לעולם אינם משתנים כדי להסתיר באג (AC-2.7.3).

import type { CompleteInput } from "../../src/domain/contracts/types.js";

export interface EmployeeCase {
  id: string;
  name: string;
  label: string;
  input: CompleteInput;
  expectedNet: number;
  expectedTax: number;
  expectedNiHealth: number;
}

// נתוני העובדים מגיליון "עובדים לדוגמה"; שווי שימוש והשתתפות מהקטלוג/חישובים.
export const EMPLOYEE_CASES: EmployeeCase[] = [
  {
    id: "E-001-today",
    name: "נועה לוי",
    label: "COROLLA CROSS (היום)",
    input: {
      route: "company_car", group: "ג",
      baseSalary: 18500, commission: 0, bonus: 0,
      pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.75,
      valueOfUse: 4070, isElectric: false, participation: 300,
      companyCarCost: 4300, maintenanceAllowance: 0,
    },
    expectedNet: 11032, expectedTax: 3443, expectedNiHealth: 2153,
  },
  {
    id: "E-001-alt",
    name: "נועה לוי",
    label: "ATTO 3 חשמלי (חלופה)",
    input: {
      route: "company_car", group: "ג",
      baseSalary: 18500, commission: 0, bonus: 0,
      pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.75,
      valueOfUse: 3130, isElectric: true, participation: 300,
      companyCarCost: 4100, maintenanceAllowance: 0,
    },
    expectedNet: 11693, expectedTax: 3283, expectedNiHealth: 2092,
  },
  {
    id: "E-002-today",
    name: "דוד כהן",
    label: "NIRO (היום)",
    input: {
      route: "company_car", group: "ב",
      baseSalary: 9800, commission: 2400, bonus: 0,
      pensionRate: 0.06, trainingRate: 0, creditPoints: 2.25,
      valueOfUse: 2950, isElectric: false, participation: 250,
      companyCarCost: 3600, maintenanceAllowance: 0,
    },
    expectedNet: 8600, expectedTax: 1369, expectedNiHealth: 1250,
  },
  {
    id: "E-002-alt",
    name: "דוד כהן",
    label: "CARNIVAL משפחתי (חלופה, 5 ילדים)",
    input: {
      route: "family", group: "ב",
      baseSalary: 9800, commission: 2400, bonus: 0,
      pensionRate: 0.06, trainingRate: 0, creditPoints: 2.25,
      valueOfUse: 8120, isElectric: false, participation: 500,
      companyCarCost: 6000, maintenanceAllowance: 0,
    },
    expectedNet: 5078, expectedTax: 2861, expectedNiHealth: 1879,
  },
  {
    id: "E-003-today",
    name: "רחל פרידמן",
    label: "ויתור - אחזקה 1500 (היום)",
    input: {
      route: "waiver", group: "ב",
      baseSalary: 21000, commission: 0, bonus: 0,
      pensionRate: 0.065, trainingRate: 0.025, creditPoints: 2.75,
      valueOfUse: 0, isElectric: false, participation: 0,
      companyCarCost: 0, maintenanceAllowance: 1500,
    },
    expectedNet: 15047, expectedTax: 3419, expectedNiHealth: 2144,
  },
  {
    id: "E-003-alt",
    name: "רחל פרידמן",
    label: "MG4 חשמלי (חלופה)",
    input: {
      route: "company_car", group: "ב",
      baseSalary: 21000, commission: 0, bonus: 0,
      pensionRate: 0.065, trainingRate: 0.025, creditPoints: 2.75,
      valueOfUse: 2430, isElectric: true, participation: 250,
      companyCarCost: 3550, maintenanceAllowance: 0,
    },
    expectedNet: 13109, expectedTax: 3910, expectedNiHealth: 2315,
  },
  {
    id: "E-004-today",
    name: "יוסי מזרחי",
    label: "TUCSON (היום)",
    input: {
      route: "company_car", group: "ג",
      baseSalary: 16000, commission: 3000, bonus: 0,
      pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.25,
      valueOfUse: 4790, isElectric: false, participation: 400,
      companyCarCost: 4450, maintenanceAllowance: 0,
    },
    expectedNet: 10693, expectedTax: 3991, expectedNiHealth: 2301,
  },
  {
    id: "E-004-alt",
    name: "יוסי מזרחי",
    label: "EV3 חשמלי (חלופה)",
    input: {
      route: "company_car", group: "ג",
      baseSalary: 16000, commission: 3000, bonus: 0,
      pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.25,
      valueOfUse: 2930, isElectric: true, participation: 300,
      companyCarCost: 4350, maintenanceAllowance: 0,
    },
    expectedNet: 11900, expectedTax: 3497, expectedNiHealth: 2128,
  },
  {
    id: "E-005-today",
    name: "מיכל אברהם",
    label: "MAZDA 3 (היום)",
    input: {
      route: "company_car", group: "ג",
      baseSalary: 27000, commission: 0, bonus: 0,
      pensionRate: 0.07, trainingRate: 0.025, creditPoints: 2.75,
      valueOfUse: 4570, isElectric: false, participation: 350,
      companyCarCost: 4200, maintenanceAllowance: 0,
    },
    expectedNet: 14244, expectedTax: 6593, expectedNiHealth: 3248,
  },
  {
    id: "E-005-alt",
    name: "מיכל אברהם",
    label: "ויתור - אחזקה 2000 (חלופה)",
    input: {
      route: "waiver", group: "ג",
      baseSalary: 27000, commission: 0, bonus: 0,
      pensionRate: 0.07, trainingRate: 0.025, creditPoints: 2.75,
      valueOfUse: 0, isElectric: false, participation: 0,
      companyCarCost: 0, maintenanceAllowance: 2000,
    },
    expectedNet: 17806, expectedTax: 5694, expectedNiHealth: 2935,
  },
  {
    id: "E-006-today",
    name: "אלי שמעון",
    label: "OCTAVIA (היום)",
    input: {
      route: "company_car", group: "ד",
      baseSalary: 32000, commission: 0, bonus: 2000,
      pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.25,
      valueOfUse: 5150, isElectric: false, participation: 500,
      companyCarCost: 5000, maintenanceAllowance: 0,
    },
    expectedNet: 17073, expectedTax: 9367, expectedNiHealth: 4170,
  },
  {
    id: "E-006-alt",
    name: "אלי שמעון",
    label: "MODEL 3 חשמלי (חלופה)",
    input: {
      route: "company_car", group: "ד",
      baseSalary: 32000, commission: 0, bonus: 2000,
      pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.25,
      valueOfUse: 4150, isElectric: true, participation: 500,
      companyCarCost: 5100, maintenanceAllowance: 0,
    },
    expectedNet: 17794, expectedTax: 9183, expectedNiHealth: 4106,
  },
];
