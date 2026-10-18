// scripts/sim/payslip-truth.ts
// ground-truth של התלושים הסינתטיים (ללא תופעות לוואי). null = לא אמור להיחלץ.
export const GROUND_TRUTH: Record<string, Record<string, number | null>> = {
  "payslip-1.pdf": { baseSalary: 18500, commission: 0, bonus: 0, pensionRate: 0.06, trainingRate: 0.025, creditPoints: 2.75 },
  "payslip-2.pdf": { baseSalary: 14200, commission: 1200, bonus: null, pensionRate: null, trainingRate: null, creditPoints: 2.25 },
  "payslip-3.pdf": { baseSalary: 16000, commission: null, bonus: 3000, pensionRate: 0.07, trainingRate: 0.025, creditPoints: null },
};