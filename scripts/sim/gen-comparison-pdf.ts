// scripts/sim/gen-comparison-pdf.ts
// מפיק PDF השוואה *מנתוני מנוע אמיתיים* (עובד הדגמה + רכב מהקטלוג) על אחסון קבצים זמני,
// בלי לגעת במסד הנתונים. לבדיקה חזותית של המסמך (רנדור ל-PNG ובדיקה בעין).
// הרצה: npx tsx scripts/sim/gen-comparison-pdf.ts <out.pdf> [employeeId] [vehicleCode] [route]
//   ברירת מחדל: E-001 CAR-10 company_car  (צפוי: 11,032 -> 11,693, הפרש 661)
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileCaseRepository } from "../../src/server/repositories/case-repository.js";
import { CaseService } from "../../src/server/services/case-service.js";
import { buildComparisonPdfModel } from "../../src/server/pdf/comparison-model.js";
import { renderComparisonPdf } from "../../src/server/pdf/comparison-pdf.js";
import type { RouteKind } from "../../src/domain/contracts/types.js";

async function main() {
  const out = process.argv[2];
  if (!out) { console.error("usage: tsx scripts/sim/gen-comparison-pdf.ts <out.pdf> [emp] [vehicle] [route]"); process.exit(1); }
  const emp = process.argv[3] ?? "E-001";
  const vehicle = process.argv[4] ?? "CAR-10";
  const route = (process.argv[5] ?? "company_car") as RouteKind;

  const dir = mkdtempSync(join(tmpdir(), "strauss-pdfgen-"));
  try {
    const service = new CaseService(new FileCaseRepository(dir));
    const owner = "pdf-sim-owner";
    const created = await service.createDemoCaseFromEmployee(owner, emp);
    await service.pickAlternative(created.case.id, owner, {
      role: "alternative", route,
      vehicleCode: route === "waiver" ? null : vehicle,
      participation: 300, maintenanceAllowance: route === "waiver" ? 1500 : 0,
    });
    const res = await service.computeAndSaveComparison(created.case.id, owner);
    if (res.status !== "ok") { console.error("comparison not ok:", res.status); process.exit(2); }

    const state = await service.getCaseState(created.case.id, owner);
    // ארגומנט 6 "stale": מדמה תוצאה מיושנת (גרסת עובדות שונה) כדי לבדוק את הבאנר.
    if (process.argv[6] === "stale") state!.case.factsRevision += 1;
    const names = await service.vehicleNames();
    const built = buildComparisonPdfModel(state!, names);
    if (!built.ok) { console.error("model failed:", built.reason, built.message); process.exit(3); }

    console.log(`engine: today=${built.model.today.net}  alt=${built.model.alternative.net}  delta=${built.model.deltaAmount} (${built.model.gain ? "gain" : "loss"})`);
    const { bytes, unsupported } = await renderComparisonPdf(built.model);
    writeFileSync(out, bytes);
    console.log(`wrote ${out} (${bytes.byteLength} bytes)`);
    console.log(unsupported.length ? `UNSUPPORTED CHARS: ${unsupported.join(" ")}` : "all characters supported by font");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
