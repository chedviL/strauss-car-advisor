// data/source/vehicle-specs.ts
// מפרטים מאושרים לשאלון ההתאמה ("איזה רכב מתאים לי?"). מקור: חבילת "רכבי שטראוס - נתונים
// מאומתים לשאלון ההתאמה, גרסה 2" (בדיקה 21.10.2026).
//
// כללים:
//  - מיובאים אך ורק שדות approved_for_feature (use = filter/allowed) + שדות תצוגה מאושרים
//    במפורש (use = display_only / display_family_only). לא מיובא historical_research_observations.
//  - כל שדה נושא יחידה, מקור, תחולה (use) וסיבת התאמה. חסר/חסום = אין ערך (לא 0) + הסבר.
//  - קודי מקור נשארים כמחרוזות. נתוני האתגר (מחיר/שווי שימוש/זכאות) אינם כאן ואינם נגזרים מכאן.
//  - CAR-20 (SANTA FE) נשאר בקטלוג העסקי אך חסום להמלצה אוטומטית לפי מפרט חיצוני.

import type {
  ApprovedField, BlockedField, CargoMethod, SpecEvidence, SpecFieldKey, SpecSource, SpecUse, VehicleSpec,
} from "../../src/domain/vehicle-match/types.js";

export const SPEC_DATA_VERSION = "2.0.0";
export const SPEC_DATA_CHECKED_AT = "2026-10-21";

const REGISTRY_RESOURCE = "142afde2-6228-49f9-8a29-9b6c3a0cbe40";

function registryUrl(tozeret: number, degem: number): string {
  // הפורמט המאושר: {"tozeret_cd": N, "degem_cd": M} עם רווחים מקודדים כ-"+".
  const spaced = `%7B%22tozeret_cd%22%3A+${tozeret}%2C+%22degem_cd%22%3A+${degem}%7D`;
  return `https://data.gov.il/api/3/action/datastore_search?resource_id=${REGISTRY_RESOURCE}&filters=${spaced}&limit=100`;
}

// קודי תוצר/דגם במאגר הדגמים של משרד התחבורה, לכל רכב.
const REGISTRY_KEYS: Record<string, [number, number]> = {
  "CAR-01": [885, 643], "CAR-02": [672, 130], "CAR-03": [1014, 12], "CAR-04": [778, 618],
  "CAR-05": [885, 619], "CAR-06": [443, 32], "CAR-07": [839, 295], "CAR-08": [253, 138],
  "CAR-09": [413, 296], "CAR-10": [1014, 3], "CAR-11": [885, 675], "CAR-12": [253, 133],
  "CAR-13": [588, 446], "CAR-14": [1327, 730], "CAR-15": [676, 1455], "CAR-16": [416, 294],
  "CAR-17": [1014, 14], "CAR-18": [413, 368], "CAR-19": [885, 648], "CAR-20": [481, 533],
};

function mk(id: string, url: string, title: string, market: string, edition: string, kind: SpecSource["kind"]): SpecSource {
  return { id, url, title, market, edition, kind };
}

/** מקורות שמוזכרים בשדות מאושרים בלבד. */
const MANUFACTURER_SOURCES: SpecSource[] = [
  mk("picanto", "https://kia-israel.co.il/catalog/mifrat-picanto.pdf", "מפרט פיקנטו, מנוע 1.0", "IL", "נוכחי", "importer"),
  mk("yaris_il", "https://lp.toyota.co.il/wp-content/uploads/2024/02/361033-2_Catalog_YarisCross_Jan24_WEB-SCROLL.pdf", "קטלוג יאריס קרוס ישראל", "IL", "01.2024", "importer"),
  mk("dolphin_ie", "https://www.bydauto.ie/assets/1/product-guides/my25/my25q3_dolphin.pdf", "BYD Dolphin MY25 technical guide", "IE", "2025 Q3", "manufacturer"),
  mk("byd_il_24", "https://bydauto.co.il/wp-content/uploads/2024/06/ashmoret.pdf", "קטלוג BYD ישראל: דולפין, ATTO 3, SEAL", "IL", "06.2024", "importer"),
  mk("leon_exact", "https://www.seat.co.il/wp-content/uploads/2024/11/BTL_141573_Mifrat_leon_d_web.pdf", "מפרט SEAT לאון STYLE 1.0", "IL", "01.2025", "manufacturer"),
  mk("niro", "https://preprod2-eu.kia.com/content/dam/kwcms/kme/ie/en/assets/contents/utilty/brochure/brochure/Niro-Brochure.pdf", "Kia Niro HEV/PHEV brochure", "IE", "ללא תאריך", "manufacturer"),
  mk("mg4_il", "https://ev360.co.il/wp-content/uploads/2025/06/NEW_MG4-X-POWER_EV_8.4.25.pdf", "חוברת יבואן MG4 (עותק בארכיון)", "IL", "2025", "importer"),
  mk("corolla", "https://www.toyota.com.tr/content/dam/toyota/nmsc/turkey/cars/e-brosur/corolla/Corolla-Teknik-ve-Donanim-Ozellikleri-01-2026.pdf", "Toyota Corolla sedan technical data", "TR", "01.2026", "manufacturer"),
  mk("kona_exact", "https://static.auto.co.il/media/hvxpvuug/hyundai-kona-ev-mifrat-2026.pdf", "מפרט יבואן קונה חשמלית 2026 (עותק)", "IL", "03.2026", "importer"),
  mk("cross", "https://lp.toyota.co.il/wp-content/uploads/2024/02/361035-3_Catalog_CorollaCross_Jan24_WEB-SCROLL.pdf", "קטלוג קורולה קרוס ישראל", "IL", "01.2024", "importer"),
  mk("atto", "https://bydauto.co.il/wp-content/uploads/2022/08/ATTO-3_Mifrat_2025.pdf", "מפרט ATTO 3 ישראל", "IL", "01.2025", "importer"),
  mk("ev3", "https://kia-israel.co.il/catalog/mifrat_EV3.pdf", "מפרט קיה EV3 ישראל", "IL", "נוכחי", "importer"),
  mk("tucson", "https://www.holonmotors.co.il/wp-content/uploads/2025/04/6199_Tuscon_FL_2025_%D7%9E%D7%95%D7%A0%D7%92%D7%A9_1702.pdf", "מפרט יבואן טוסון 2025 (עותק בסוכנות)", "IL", "2025", "importer"),
  mk("mazda_exact", "https://api.mazda.co.il/Uploads/New/3%20SDN/%D7%9E%D7%A4%D7%A8%D7%98/39872%20Mazda3%20Sedan.pdf", "מפרט מאזדה 3 סדאן 2.5", "IL", "01.2026", "manufacturer"),
  mk("tesla", "https://www.tesla.com/ownersmanual/model3/he_il/GUID-56562137-FC31-4110-A13C-9A9FC6657BF0.html", "מדריך בעלים Tesla Model 3: מידות", "IL", "דור 2024+", "manufacturer"),
  mk("octavia_prefl", "https://cdn.skoda-storyboard.com/2019/08/TD-OCTAVIA-en.pdf", "Octavia 2.0 TDI technical data", "EU", "01.2023", "manufacturer"),
  mk("sportage_phev", "https://kia-israel.co.il/catalog/mifrat-sportage-plug-in-hybrid.pdf", "מפרט ספורטאז׳ פלאג־אין", "IL", "2026", "importer"),
  mk("seal_il", "https://bydauto.co.il/wp-content/uploads/2024/02/BTL_135107_Mifrat_Seal_j.pdf", "מפרט SEAL ישראל", "IL", "ברושור 2025", "importer"),
  mk("rav4", "https://lp.toyota.co.il/wp-content/uploads/2024/02/361038-3_Catalog-RAV4_Jan24_WEB-SCROLL.pdf", "קטלוג RAV4 ישראל", "IL", "01.2024", "importer"),
  mk("carnival", "https://kia-israel.co.il/חדשות/קיה-קרניבל-2025-החדש-נחת-בישראל-מחיר-החל-מ-2899", "קיה קרניבל 2025: מידות ו־8 מושבים", "IL", "22.12.2024", "importer"),
  mk("santafe_body", "https://www.hyundai.com/content/dam/hyundai/au/en/models/santa-fe-ice/docs/Santa-Fe-MX5-Specification-Sheet.pdf", "Santa Fe MX5 body dimensions", "AU", "משפחת דגם בלבד", "manufacturer"),
];

export const SPEC_SOURCES: Record<string, SpecSource> = (() => {
  const out: Record<string, SpecSource> = {};
  for (const s of MANUFACTURER_SOURCES) out[s.id] = s;
  for (const [id, [t, d]] of Object.entries(REGISTRY_KEYS)) {
    const sid = `registry_${id}`;
    out[sid] = mk(sid, registryUrl(t, d), "מאגר הדגמים של משרד התחבורה", "IL", "נשלף 21.10.2026", "registry");
  }
  return out;
})();

// ───────────── בניית רשומות ─────────────

const BASIS_REGISTRY = "רשומה מדויקת במאגר הדגמים של משרד התחבורה";
const BASIS_VARIANT = "זיהוי במרשם + גרסה תואמת במפרט היצרן/היבואן";
const BASIS_IMPORTER_CODE = "התאמה ישירה של קוד הדגם והגימור במפרט היבואן";
const BASIS_FAMILY_BODY = "מידות מרכב משותף לאותה הנעה (לא אבזור גימור)";
const BASIS_FAMILY_ONLY = "מידות משפחת הדגם בלבד - אינן שייכות בוודאות לגרסת הקטלוג";

interface Body {
  mfr: string;
  basisHe: string;
  locator: string | null;
  noteHe?: string;
}

interface Build {
  id: string;
  trim: string | null;
  enabled?: boolean;
  registry: VehicleSpec["registry"];
  seats?: number;
  body: Body;
  mm?: { length?: number; width?: number; height?: number; wheelbase?: number };
  mmUse?: SpecUse;
  boot?: number;
  bootUse?: SpecUse;
  frunk?: number;
  battery?: number;
  range?: number;
  rangeEvidence?: Partial<SpecEvidence> & { sourceIds: string[] };
  ac?: number;
  dc?: number;
  blocked?: Partial<Record<SpecFieldKey, BlockedField>>;
  cargo: { method: CargoMethod; seatsInUse: number | null };
  notesHe?: string[];
}

function build(b: Build): VehicleSpec {
  const regSrc = `registry_${b.id}`;
  const regEv: SpecEvidence = { sourceIds: [regSrc], basisHe: BASIS_REGISTRY, locator: null, noteHe: "" };
  const bodyEv: SpecEvidence = {
    sourceIds: [regSrc, b.body.mfr], basisHe: b.body.basisHe, locator: b.body.locator, noteHe: b.body.noteHe ?? "",
  };
  const fields: VehicleSpec["fields"] = {};
  const put = (key: SpecFieldKey, value: number | undefined, unit: string, use: SpecUse, ev: SpecEvidence): void => {
    if (value === undefined) return;
    const f: ApprovedField = { value, unit, use, evidence: ev };
    fields[key] = f;
  };
  const mmUse = b.mmUse ?? "allowed";
  put("seats", b.seats, "persons_including_driver", "filter", regEv);
  put("lengthMm", b.mm?.length, "mm", mmUse, bodyEv);
  put("widthMm", b.mm?.width, "mm", mmUse, bodyEv);
  put("heightMm", b.mm?.height, "mm", mmUse, bodyEv);
  put("wheelbaseMm", b.mm?.wheelbase, "mm", mmUse, bodyEv);
  put("bootRearSeatsUpL", b.boot, "L", b.bootUse ?? "allowed", bodyEv);
  put("frunkL", b.frunk, "L", "allowed", bodyEv);
  put("batteryKwh", b.battery, "kWh", "allowed", bodyEv);
  put("rangeWltpKm", b.range, "km_WLTP_combined", "allowed", b.rangeEvidence ? { ...bodyEv, ...b.rangeEvidence } : bodyEv);
  put("acMaxKw", b.ac, "kW", "allowed", bodyEv);
  put("dcMaxKw", b.dc, "kW", "allowed", bodyEv);
  return {
    id: b.id,
    automaticRecommendationEnabled: b.enabled ?? true,
    registryTrim: b.trim,
    registry: b.registry,
    fields,
    blocked: b.blocked ?? {},
    cargo: b.cargo,
    notesHe: b.notesHe ?? [],
  };
}

const R = (bodyType: string, fuel: string, powertrain: string, drive: string): VehicleSpec["registry"] =>
  ({ bodyType, fuel, powertrain, drive });

const UNSPEC = { method: "unspecified" as const, seatsInUse: 5 };

export const VEHICLE_SPECS: VehicleSpec[] = [
  build({
    id: "CAR-01", trim: "LX", registry: R("הצ'בק", "בנזין", "הנעה רגילה", "4X2"), seats: 5,
    body: { mfr: "picanto", basisHe: BASIS_FAMILY_BODY, locator: "p2 dimensions",
      noteHe: "המפרט הנוכחי הוא מנוע 1.0; רק מידות המרכב ונפח התא המשותפים למרכב זה אומצו, לא נתוני המנוע/אבזור." },
    mm: { length: 3605, width: 1595, height: 1485, wheelbase: 2400 }, boot: 255, cargo: UNSPEC,
  }),
  build({
    id: "CAR-02", trim: "URBAN", registry: R("פנאי-שטח", "בנזין", "היברידי רגיל", "4X2"), seats: 5,
    body: { mfr: "yaris_il", basisHe: BASIS_VARIANT, locator: "p11 Hybrid Urban",
      noteHe: "URBAN הנעה קדמית זוהה ברשומה המדויקת." },
    mm: { width: 1765, height: 1595, wheelbase: 2560 }, boot: 397,
    blocked: { lengthMm: { reasonHe: "במקורות מופיעים שני ערכי אורך סותרים (4172 ו־4180 מ״מ), לכן לא נקבע ערך יחיד.", range: [4172, 4180] } },
    cargo: { method: "vda_beltline", seatsInUse: 5 },
  }),
  build({
    id: "CAR-03", trim: "DESIGN", registry: R("הצ'בק", "חשמל", "רכב חשמלי", "4X2"), seats: 5,
    body: { mfr: "dolphin_ie", basisHe: BASIS_VARIANT, locator: "MY25 specification p5",
      noteHe: "Design 204 כ״ס זוהה במרשם; מפרט משפחה זהה. נתוני אבזור של שוק אחר לא אומצו." },
    mm: { length: 4290, width: 1770, height: 1570, wheelbase: 2700 }, boot: 345, battery: 60.4, range: 427,
    rangeEvidence: { sourceIds: ["registry_CAR-03", "byd_il_24"], locator: "p4-5 Dolphin", noteHe: "" },
    cargo: UNSPEC,
  }),
  build({
    id: "CAR-04", trim: "STYLE", registry: R("הצ'בק", "בנזין", "הנעה רגילה", "4X2"), seats: 5,
    body: { mfr: "leon_exact", basisHe: BASIS_IMPORTER_CODE, locator: "p1 technical table and code 00778-0618" },
    mm: { length: 4368, width: 1799, height: 1456, wheelbase: 2669 }, boot: 380, cargo: UNSPEC,
  }),
  build({
    id: "CAR-05", trim: "SILVER", registry: R("הצ'בק", "בנזין", "היברידי רגיל", "4X2"), seats: 5,
    body: { mfr: "niro", basisHe: BASIS_VARIANT, locator: "p3 HEV", noteHe: "SILVER HEV מהדור השני, לא הדור הישן ולא פלאג־אין." },
    mm: { length: 4420, width: 1825, height: 1545, wheelbase: 2720 },
    blocked: { bootRearSeatsUpL: { reasonHe: "נפח המטען לא נקבע לגרסה הזו (תלוי בתצורת הרצפה והגלגל החלופי)." } },
    cargo: { method: "vda_beltline", seatsInUse: 5 },
  }),
  build({
    id: "CAR-06", trim: "LUXURY", registry: R("הצ'בק", "חשמל", "רכב חשמלי", "4X2"), seats: 5,
    body: { mfr: "mg4_il", basisHe: "זיהוי Luxury 204 כ״ס במרשם + חוברת יבואן מתוארכת", locator: "PDF p15 technical table, p18 date",
      noteHe: "נפח 350 ליטר שייך ל־Luxury; ערכים של גרסאות אחרות לא הועתקו." },
    mm: { length: 4287, width: 1836, height: 1516, wheelbase: 2705 }, boot: 350, battery: 64, range: 435, ac: 11, dc: 135, cargo: UNSPEC,
  }),
  build({
    id: "CAR-07", trim: "COMFORT", registry: R("סדאן", "בנזין", "הנעה רגילה", "4X2"), seats: 5,
    body: { mfr: "corolla", basisHe: BASIS_VARIANT, locator: "2026 TR petrol sedan technical table",
      noteHe: "COMFORT 1.5 בנזין 125 כ״ס; זהות נקבעה במרשם. לא נתוני קורולה היברידית." },
    mm: { length: 4630, width: 1780, height: 1435 }, boot: 471, cargo: UNSPEC,
  }),
  build({
    id: "CAR-08", trim: "PURE EV", registry: R("פנאי-שטח", "חשמל", "רכב חשמלי", "4X2"), seats: 5,
    body: { mfr: "kona_exact", basisHe: "זיהוי PURE EV 2026 במרשם + ברושור יבואן לפי גימור", locator: "p2 Pure column; p3 March 2026 date" },
    mm: { length: 4355, width: 1825, height: 1580, wheelbase: 2660 }, boot: 466, frunk: 27, battery: 65.4, range: 506, cargo: UNSPEC,
  }),
  build({
    id: "CAR-09", trim: "DYNAMIC", registry: R("פנאי-שטח", "בנזין", "היברידי רגיל", "4X2"), seats: 5,
    body: { mfr: "cross", basisHe: BASIS_VARIANT, locator: "p11 Dynamic column", noteHe: "Dynamic זוהה במרשם; 403 ליטר שייך ל־Active." },
    mm: { length: 4460, width: 1825, height: 1620, wheelbase: 2640 }, boot: 436,
    cargo: { method: "vda_beltline", seatsInUse: 5 },
  }),
  build({
    id: "CAR-10", trim: "DESIGN", registry: R("פנאי-שטח", "חשמל", "רכב חשמלי", "4X2"), seats: 5,
    body: { mfr: "atto", basisHe: "תיאור הדגם והגימור במרשם + ברושור יבואן 2025", locator: "p3 Design column; p5 edition 01.2025",
      noteHe: "רשומה בעלת קוד מספרי חופף נדחתה לפי תיאור הדגם." },
    mm: { length: 4455, width: 1875, height: 1615, wheelbase: 2720 }, boot: 440, battery: 60.4, range: 420, ac: 11, dc: 110, cargo: UNSPEC,
  }),
  build({
    id: "CAR-11", trim: "PREMIUM SR", registry: R("פנאי-שטח", "חשמל", "רכב חשמלי", "4X2"), seats: 5,
    body: { mfr: "ev3", basisHe: "זיהוי PREMIUM SR במרשם + מפרט יבואן באותו קוד", locator: "p1 code 675; p2 SR Premium column",
      noteHe: "גרסת SR בלבד: 58.3 קוט״ש ו־432 ק״מ." },
    mm: { length: 4300, width: 1850, height: 1560, wheelbase: 2680 }, boot: 460, frunk: 25, battery: 58.3, range: 432, cargo: UNSPEC,
  }),
  build({
    id: "CAR-12", trim: "PREMIUM FL", registry: R("פנאי-שטח", "בנזין", "הנעה רגילה", "4X2"), seats: 5,
    body: { mfr: "tucson", basisHe: "זיהוי PREMIUM FL במרשם + מפרט יבואן מקומי 2025", locator: "p10 Premium FL table" },
    mm: { length: 4510, width: 1865, height: 1650, wheelbase: 2680 }, boot: 515, cargo: UNSPEC,
  }),
  build({
    id: "CAR-13", trim: "SPIRIT", registry: R("סדאן", "בנזין", "הנעה רגילה", "4X2"), seats: 5,
    body: { mfr: "mazda_exact", basisHe: "סדאן SPIRIT 191 כ״ס במרשם + מפרט יבואן לקוד 446", locator: "p2 dimensions; p7 code 446",
      noteHe: "סדאן 2.5 ליטר, לא האצ׳בק." },
    mm: { length: 4660, width: 1795, height: 1440, wheelbase: 2725 }, boot: 444, cargo: UNSPEC,
  }),
  build({
    id: "CAR-14", trim: "RWD", registry: R("סדאן", "חשמל", "רכב חשמלי", "4X2"), seats: 5,
    body: { mfr: "tesla", basisHe: "זיהוי RWD במרשם + מדריך היצרן לגרסת RWD", locator: "RWD/LongRange dimensions; cargo table",
      noteHe: "נתוני מדריך בקירוב. 594 ליטר לפי שיטת Tesla (מאחורי השורה השנייה), לא VDA." },
    mm: { length: 4720, width: 1850, height: 1440, wheelbase: 2875 }, boot: 594, bootUse: "display_only", frunk: 88,
    blocked: { rangeWltpKm: { reasonHe: "הטווח לא נקבע לגרסה (תלוי בסוללה ובעדכון במהלך 2025)." } },
    cargo: { method: "tesla_behind_second_row", seatsInUse: 5 },
  }),
  build({
    id: "CAR-15", trim: "AMBITION", registry: R("סדאן", "דיזל", "הנעה רגילה", "4X2"), seats: 5,
    body: { mfr: "octavia_prefl", basisHe: BASIS_VARIANT, locator: "p5-6 2.0TDI FWD Ambition",
      noteHe: "Ambition TDI 150 זוהה במרשם; לא מפרט פייסליפט 2025." },
    mm: { length: 4689, width: 1829, height: 1470, wheelbase: 2686 }, boot: 600, cargo: UNSPEC,
    notesHe: ["בקטלוג העסקי הרכב מופיע כבנזין ובמרשם הרכב כדיזל. לא חישבנו צריכת דלק."],
  }),
  build({
    id: "CAR-16", trim: "PREMIUM", registry: R("פנאי-שטח", "חשמל/בנזין", "PLUG IN", "4X2"), seats: 5,
    body: { mfr: "sportage_phev", basisHe: "פלאג־אין 288 כ״ס הנעה קדמית במרשם + גוף וסוללה משותפים במפרט היבואן", locator: "p2 dimensions and PHEV 288hp FWD",
      noteHe: "אומצו רק נתוני גוף וסוללה המשותפים לאותה הנעה, לא אבזור גימור." },
    mm: { length: 4540, width: 1865, height: 1650, wheelbase: 2680 }, boot: 540, battery: 13.8,
    blocked: { rangeWltpKm: { reasonHe: "המקורות מציגים ערכי טווח שונים (68 ו־69 ק״מ), לכן לא נקבע ערך." } },
    cargo: UNSPEC,
    notesHe: ["במרשם הרכב מסווג כפלאג־אין (נטען), למרות השם HEV."],
  }),
  build({
    id: "CAR-17", trim: "DESIGN 4-4", registry: R("סדאן", "חשמל", "רכב חשמלי", "4X4"), seats: 5,
    body: { mfr: "seal_il", basisHe: "הנעה 4x4 והספק 530 במרשם תואמים לעמודת AWD במפרט היבואן", locator: "p3 Excellence-AWD 530hp column",
      noteHe: "הטווח 520 ק״מ הוא של הנעה כפולה, לא 570 של RWD." },
    mm: { length: 4800, width: 1875, height: 1460, wheelbase: 2920 }, boot: 400, frunk: 53, battery: 82.5, range: 520, ac: 11, dc: 150, cargo: UNSPEC,
  }),
  build({
    id: "CAR-18", trim: "COMFORT", registry: R("פנאי-שטח", "בנזין", "היברידי רגיל", "4X2"), seats: 5,
    body: { mfr: "rav4", basisHe: BASIS_VARIANT, locator: "p9 4x2 luggage and dimensions", noteHe: "Comfort הנעה קדמית, אותו דור RAV4." },
    mm: { length: 4600, width: 1855, wheelbase: 2690 }, boot: 580,
    cargo: { method: "vda_beltline", seatsInUse: 5 },
  }),
  build({
    id: "CAR-19", trim: "EX", registry: R("MPV", "בנזין", "הנעה רגילה", "4X2"), seats: 8,
    body: { mfr: "carnival", basisHe: BASIS_VARIANT, locator: "2025 launch dimensions; 8 seats all in use",
      noteHe: "627 ליטר נמדד כשכל 8 המושבים בשימוש." },
    mm: { length: 5155, width: 1995, height: 1775, wheelbase: 3090 }, boot: 627,
    cargo: { method: "unspecified", seatsInUse: 8 },
  }),
  build({
    id: "CAR-20", trim: null, enabled: false, registry: null,
    body: { mfr: "santafe_body", basisHe: BASIS_FAMILY_ONLY, locator: "MX5 shared body dimensions",
      noteHe: "הרשומה במרשם קיימת לשנתון 2026 ולא ל־2025; אין להחיל כנתון ודאי של הקטלוג." },
    mm: { length: 4830, width: 1900, wheelbase: 2815 }, mmUse: "display_family_only",
    blocked: {
      seats: { reasonHe: "אין התאמה חד־משמעית למפתח הרכב בקטלוג; מספר המושבים לא נקבע." },
      bootRearSeatsUpL: { reasonHe: "ללא הכרעה במספר המושבים והגרסה אין נפח יחיד." },
    },
    cargo: { method: "unconfirmed", seatsInUse: null },
  }),
];

export const SPECS_BY_ID: Map<string, VehicleSpec> = new Map(VEHICLE_SPECS.map((s) => [s.id, s]));

/** סטטיסטיקת כיסוי לדוח: כמה רכבים ולכמה שדות יש אישור לשימוש בפיצ'ר. */
export function approvedFieldCoverage(): { vehicles: number; fields: number; perVehicle: Record<string, number> } {
  const perVehicle: Record<string, number> = {};
  let fields = 0;
  for (const s of VEHICLE_SPECS) {
    const n = Object.values(s.fields).filter((f) => f.use === "filter" || f.use === "allowed").length;
    perVehicle[s.id] = n;
    fields += n;
  }
  return { vehicles: VEHICLE_SPECS.filter((s) => (perVehicle[s.id] ?? 0) > 0).length, fields, perVehicle };
}
