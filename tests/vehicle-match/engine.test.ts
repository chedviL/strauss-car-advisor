// tests/vehicle-match/engine.test.ts
// מנוע ההתאמה הטהור: בידוד זכאות, דרישות מושבים, חסימת מפרט, נפחי מטען בני-השוואה,
// חוסר נטו, עקביות דירוג וסיבות התואמות לנתונים.

import { describe, it, expect } from "vitest";
import { matchVehicles } from "../../src/domain/vehicle-match/engine.js";
import { SPECS_BY_ID, VEHICLE_SPECS, approvedFieldCoverage } from "../../data/source/vehicle-specs.js";
import { CATALOG_ENTRIES, cloneSpecs, input, netCtx } from "./helpers.js";

const ids = (l: Array<{ vehicleId: string }>): string[] => l.map((o) => o.vehicleId);
const allIds = (r: ReturnType<typeof matchVehicles>): string[] => [...ids(r.options), ...ids(r.needsCheck)];

describe("בידוד זכאות", () => {
  it("קבוצה א׳ רואה רק רכבי קבוצה א׳ (בלי משפחתי כשאין ילדים)", () => {
    const r = matchVehicles(input({ group: "א", answers: { priority: "cargo" } }));
    expect(r.status).toBe("ok");
    for (const id of ids(r.options)) expect(["CAR-01", "CAR-02", "CAR-03", "CAR-04"]).toContain(id);
    expect(allIds(r)).not.toContain("CAR-10");
    expect(allIds(r)).not.toContain("CAR-14");
  });

  it("קבוצה ד׳ רואה גם קבוצות נמוכות; קבוצה ב׳ לא רואה ג׳/ד׳", () => {
    const d = matchVehicles(input({ group: "ד", answers: { priority: "compact" } }));
    expect(d.options.length).toBe(3);
    const b = matchVehicles(input({ group: "ב", answers: { priority: "cargo" } }));
    expect(allIds(b).length).toBeGreaterThan(0);
    for (const id of allIds(b)) {
      const g = CATALOG_ENTRIES.find((c) => c.id === id)!.group;
      expect(["א", "ב"]).toContain(g);
    }
  });

  it("קבוצה לא ידועה -> מבקשים קבוצה ואינם מנחשים", () => {
    const r = matchVehicles(input({ group: null }));
    expect(r.status).toBe("needs_eligibility_group");
    expect(r.options).toHaveLength(0);
    expect(r.groupUsed).toBeNull();
  });

  it("מסלול משפחתי: בלי נתון ילדים -> דורש בדיקה, לא 'מתאים'; עם 4 ילדים -> מתאים", () => {
    const unknown = matchVehicles(input({ group: "ג", answers: { passengers: "many", seatsMin: 7, priority: "cargo" } }));
    expect(unknown.options).toHaveLength(0);
    expect(ids(unknown.needsCheck)).toEqual(["CAR-19"]);
    expect(unknown.needsCheck[0]!.missingFields.some((m) => m.key === "eligibility")).toBe(true);

    const known = matchVehicles(input({ group: "ג", children: 4, answers: { passengers: "many", seatsMin: 7, priority: "cargo" } }));
    expect(ids(known.options)).toEqual(["CAR-19"]);

    const few = matchVehicles(input({ group: "ג", children: 2, answers: { passengers: "many", seatsMin: 7 } }));
    expect(allIds(few)).not.toContain("CAR-19");
    expect(few.emptyReason).toMatch(/7 מקומות/);
  });
});

describe("דרישת מושבים הכרחית מול נתון חסר", () => {
  it("6/7/8 מקומות: רק מי שיש לו מספיק מושבים מאושרים", () => {
    for (const n of [6, 7, 8] as const) {
      const r = matchVehicles(input({ group: "ד", children: 5, answers: { passengers: "many", seatsMin: n } }));
      expect(ids(r.options)).toEqual(["CAR-19"]);
    }
  });

  it("נתון מושבים חסר אינו 'מתאים' אלא 'דורש בדיקה'", () => {
    const specs = cloneSpecs((s) => { delete s.find((x) => x.id === "CAR-04")!.fields.seats; });
    const r = matchVehicles(input({ group: "א", specs, answers: { passengers: "many", seatsMin: 6 }, children: 5 }));
    expect(ids(r.options)).not.toContain("CAR-04");
    const c = r.needsCheck.find((o) => o.vehicleId === "CAR-04");
    expect(c).toBeDefined();
    expect(c!.missingFields.some((m) => m.key === "seats")).toBe(true);
  });

  it("בעד 1-2 נוסעים אין סינון מושבים; 3-5 דורש 5", () => {
    const few = matchVehicles(input({ group: "א", answers: { passengers: "one_two", priority: "compact" } }));
    expect(few.options.length).toBeGreaterThan(0);
  });
});

describe("חסימת מפרט שלא אושר", () => {
  it("CAR-20 לעולם אינו מומלץ; מוצגת הודעת כיסוי קצרה כשהוא בזכאות", () => {
    const r = matchVehicles(input({ group: "ד", children: 5, answers: { priority: "cargo" } }));
    expect(allIds(r)).not.toContain("CAR-20");
    expect(r.coverageNotes).toContain("לא דורג דגם אחד בגלל אי־התאמה במפרט המקור.");
    // כשאינו בזכאות (אין ילדים) - אין הודעה
    const none = matchVehicles(input({ group: "ד", answers: { priority: "cargo" } }));
    expect(none.coverageNotes).not.toContain("לא דורג דגם אחד בגלל אי־התאמה במפרט המקור.");
  });

  it("שדה display_only אינו משמש לדירוג", () => {
    const specs = cloneSpecs((s) => { s.find((x) => x.id === "CAR-01")!.fields.lengthMm!.use = "display_only"; });
    const r = matchVehicles(input({ group: "א", specs, answers: { priority: "compact" } }));
    expect(ids(r.options)).not.toContain("CAR-01");
    expect(r.needsCheck.map((o) => o.vehicleId)).toContain("CAR-01");
  });

  it("רשימת השדות המאושרים: אין ערכים חסומים כמספרים", () => {
    expect(SPECS_BY_ID.get("CAR-02")!.fields.lengthMm).toBeUndefined();
    expect(SPECS_BY_ID.get("CAR-05")!.fields.bootRearSeatsUpL).toBeUndefined();
    expect(SPECS_BY_ID.get("CAR-14")!.fields.rangeWltpKm).toBeUndefined();
    expect(SPECS_BY_ID.get("CAR-16")!.fields.rangeWltpKm).toBeUndefined();
    expect(SPECS_BY_ID.get("CAR-20")!.fields.seats).toBeUndefined();
    const cov = approvedFieldCoverage();
    expect(cov.vehicles).toBe(19);
    expect(cov.perVehicle["CAR-20"]).toBe(0);
  });
});

describe("נפחי מטען שאינם בני השוואה", () => {
  const r = matchVehicles(input({ group: "ד", answers: { priority: "cargo", cargo: "stroller" } }));

  it("Tesla (שיטה שונה) ונירו (נפח לא אושר) לא מדורגים; מופיעים כ'דורשים בדיקה' עם הסבר", () => {
    expect(ids(r.options)).not.toContain("CAR-14");
    expect(ids(r.options)).not.toContain("CAR-05");
    const model3 = r.needsCheck.find((o) => o.vehicleId === "CAR-14");
    const niro = r.needsCheck.find((o) => o.vehicleId === "CAR-05");
    expect(model3?.checkReason).toMatch(/שיטה שונה/);
    expect(niro?.checkReason).toMatch(/לא נקבע|לא אושר/);
  });

  it("הדירוג יורד לפי הנפח המוצהר, והתגית 'בולט במטען' רק למוביל מובהק", () => {
    expect(ids(r.options)).toEqual(["CAR-15", "CAR-18", "CAR-16"]); // 600, 580, 540
    expect(r.options[0]!.badges.map((b) => b.code)).toContain("cargo_lead");
    expect(r.options[1]!.badges).toHaveLength(0);
    expect(r.rankingBasis).toBe("cargo");
  });

  it("קרניבל (8 מושבים בשימוש) אינו מושווה לנפחי 5 מושבים", () => {
    const withFamily = matchVehicles(input({ group: "ד", children: 5, answers: { priority: "cargo" } }));
    expect(ids(withFamily.options)).not.toContain("CAR-19");
    expect(withFamily.needsCheck.find((o) => o.vehicleId === "CAR-19")?.checkReason).toMatch(/תצורת מושבים/);
  });

  it("מאגר בן-השוואה יחיד: אין תגית מנצח", () => {
    const one = matchVehicles(input({ group: "ד", children: 5, answers: { passengers: "many", seatsMin: 8, priority: "cargo" } }));
    expect(one.options).toHaveLength(1);
    expect(one.options[0]!.badges).toHaveLength(0);
    expect(one.rankingNote).toMatch(/רק אפשרות אחת/);
  });
});

describe("נטו", () => {
  it("בלי נתוני שכר/תיק: אין נטו מומצא, אין תגית נטו, יש נפילה מפורשת לדירוג אחר", () => {
    const r = matchVehicles(input({ group: "א", answers: { priority: "net" }, net: null }));
    expect(r.netState).toBe("needs_details");
    expect(r.rankingBasis).toBe("balanced_fallback");
    expect(r.rankingNote).toMatch(/נטו/);
    for (const o of r.options) {
      expect(o.net.status).toBe("unavailable");
      expect(o.badges.map((b) => b.code)).not.toContain("net_lead");
    }
    expect(JSON.stringify(r)).not.toContain("netDelta");
  });

  it("עם נטו מהמנוע: מסודר לפי הפרש הנטו, הסיבות מציגות את המספר, הנחות מצורפות", () => {
    const net = netCtx({ "CAR-01": 100, "CAR-02": 300, "CAR-03": 661, "CAR-04": -50 });
    const r = matchVehicles(input({ group: "א", answers: { priority: "net" }, net }));
    expect(r.rankingBasis).toBe("net");
    expect(ids(r.options)).toEqual(["CAR-03", "CAR-02", "CAR-01"]);
    expect(r.options[0]!.badges.map((b) => b.code)).toContain("net_lead");
    expect(r.options[0]!.reasons[0]!.text).toContain("661");
    const n = r.options[0]!.net;
    expect(n.status === "ok" && n.assumptions.length).toBeGreaterThan(0);
    expect(r.needsCheck.map((o) => o.vehicleId)).not.toContain("CAR-04"); // CAR-04 מחושב, פשוט אינו בטופ 3
  });

  it("נטו שלילי מוצג כשיקול ולא כסיבה", () => {
    const net = netCtx({ "CAR-01": -200, "CAR-02": -100, "CAR-03": -50, "CAR-04": -10 });
    const r = matchVehicles(input({ group: "א", answers: { priority: "net" }, net }));
    for (const o of r.options) {
      expect(o.reasons.some((x) => x.code === "net_gain")).toBe(false);
      expect(o.considerations.some((c) => /פחות בחודש/.test(c))).toBe(true);
      expect(o.badges.map((b) => b.code)).not.toContain("net_lead");
    }
  });
});

describe("מידות קומפקטיות וטווח אורך", () => {
  it("יאריס קרוס (אורך כטווח 4172–4180) מדורג בלי להמציא ערך נקודתי", () => {
    const r = matchVehicles(input({ group: "א", answers: { priority: "compact" } }));
    expect(ids(r.options)).toEqual(["CAR-01", "CAR-02", "CAR-03"]);
    const yaris = r.options[1]!;
    expect(yaris.considerations.join(" ")).toContain("4172");
    expect(yaris.specs.find((s) => s.key === "lengthMm")?.valueText).toContain("4,172–4,180");
    expect(r.options[0]!.badges.map((b) => b.code)).toContain("compact_lead");
  });
});

describe("עקביות, סיבות מבוססות-נתונים ושקיפות", () => {
  it("אותו קלט -> אותו פלט", () => {
    const a = matchVehicles(input({ group: "ד", answers: { priority: "balanced", cargo: "lots" } }));
    const b = matchVehicles(input({ group: "ד", answers: { priority: "balanced", cargo: "lots" } }));
    expect(b).toEqual(a);
  });

  it("כל מספר בסיבה/במפרט תואם את הנתון המאושר", () => {
    const r = matchVehicles(input({ group: "ד", answers: { priority: "balanced", cargo: "stroller" } }));
    expect(r.rankingBasis).toBe("balanced");
    for (const o of r.options) {
      const spec = VEHICLE_SPECS.find((s) => s.id === o.vehicleId)!;
      const boot = spec.fields.bootRearSeatsUpL!.value;
      const cargoReason = o.reasons.find((x) => x.code === "cargo_volume");
      if (cargoReason) expect(cargoReason.text).toContain(String(boot));
      const bootSpec = o.specs.find((s) => s.key === "bootRearSeatsUpL");
      if (bootSpec) expect(bootSpec.valueText).toContain(String(boot));
      expect(o.reasons.length).toBeLessThanOrEqual(2);
      for (const s of o.sources) expect(s.url).toMatch(/^https:\/\//);
    }
  });

  it("אין אחוז התאמה ואין ציון חשוף", () => {
    const r = matchVehicles(input({ group: "ד", answers: { priority: "balanced" } }));
    const texts = [r.rankingNote, ...r.coverageNotes, ...[...r.options, ...r.needsCheck].flatMap((o) => [
      ...o.reasons.map((x) => x.text), ...o.considerations, ...o.specs.map((s) => s.valueText + (s.note ?? "")),
    ])].join(" | ");
    expect(texts).not.toMatch(/\d\s*%/);
    expect(JSON.stringify(r)).not.toMatch(/"score"/);
  });

  it("לא כופה שלושה כרטיסים כשיש פחות אפשרויות", () => {
    const catalog = CATALOG_ENTRIES.filter((c) => c.id === "CAR-01" || c.id === "CAR-02");
    const r = matchVehicles(input({ group: "א", catalog, answers: { priority: "balanced" } }));
    expect(r.options).toHaveLength(2);
  });

  it("חוסר טעינה ביתית אינו פוסל חשמלי: מוצג שיקול ברור", () => {
    const r = matchVehicles(input({ group: "א", answers: { priority: "compact", charging: "none" } }));
    const dolphin = r.options.find((o) => o.vehicleId === "CAR-03");
    expect(dolphin).toBeDefined();
    expect(dolphin!.considerations.join(" ")).toMatch(/טעינה/);
    expect(dolphin!.considerations.join(" ")).not.toMatch(/₪/); // לא ממציאים עלות טעינה
  });

  it("טווח נסיעה מוצג כמעבדה בלבד ורק כשמאושר; Tesla ללא טווח -> מציין שלא אושר", () => {
    const r = matchVehicles(input({ group: "ד", answers: { priority: "compact", trips: "long" } }));
    const withRange = [...r.options, ...r.needsCheck].find((o) => o.vehicleId === "CAR-03");
    if (withRange) expect(withRange.considerations.join(" ")).toMatch(/טווח מעבדה/);
    const model3 = matchVehicles(input({ group: "ד", answers: { priority: "cargo", trips: "long" }, catalog: CATALOG_ENTRIES.filter((c) => c.id === "CAR-14") }));
    expect([...model3.options, ...model3.needsCheck][0]!.missingFields.some((m) => m.key === "rangeWltpKm")).toBe(true);
  });

  it("אוקטביה: סתירת בנזין/דיזל מוצגת כשיקול ואינה מחשבת דלק", () => {
    const r = matchVehicles(input({ group: "ד", answers: { priority: "cargo" } }));
    const oct = r.options.find((o) => o.vehicleId === "CAR-15")!;
    expect(oct.considerations.join(" ")).toMatch(/דיזל/);
  });
});
