// src/domain/vehicle-match/engine.ts
// מנוע התאמה טהור ל"איזה רכב מתאים לי?". דטרמיניסטי: בלי רשת, מסד, מודל או זמן.
//
// סדר הפעולות:
//  1. סינון זכאות (הפונקציה eligibilityCheck מגיעה ממנוע הזכאות הקיים).
//  2. דרישות הכרחיות (מושבים). נתון חסר => "דורש בדיקה", לא "מתאים".
//  3. זיהוי נתונים חסרים/לא ברי-השוואה לכל קריטריון.
//  4. דירוג לפי ההעדפה המובילה על בסיס נתונים מאושרים ובני השוואה בלבד.
//  5. צירוף נטו מהמנוע הקיים (כשהתקבל מבחוץ).
//
// אין כאן ציון/אחוז התאמה. נתון חסר לעולם אינו 0 ואינו מוריד ציון בשקט.

import type {
  BadgeCode, CatalogEntry, CompleteAnswers, DisplaySpec, MatchEngineInput, MatchOption, MatchResult,
  MissingField, NetOutcome, RankingBasis, Reason, SpecFieldKey, SpecSource, VehicleSpec,
} from "./types.js";

// ───────────── בחירות מוצר (לא אמת מדעית) ─────────────

/** משקולות הדירוג ב"איזון". בחירת מוצר שקופה; מנורמלות מחדש על הקריטריונים הזמינים בפועל. */
export const BALANCED_WEIGHTS = { net: 0.4, cargo: 0.3, compact: 0.3 } as const;
export const MAX_OPTIONS = 3;
export const MAX_NEEDS_CHECK = 3;

type Criterion = "net" | "cargo" | "compact";
const CRITERION_LABEL: Record<Criterion, string> = {
  net: "הפרש הנטו", cargo: "נפח המטען המוצהר", compact: "המידות החיצוניות",
};

const PROPULSION_LABEL = ["בנזין", "היברידי", "פלאג־אין", "חשמלי"] as const;
const COMPARABLE_CARGO = new Set(["vda_beltline", "unspecified"]);

// ───────────── עזרים ─────────────

const nf = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 });
const n0 = (v: number): string => nf.format(Math.round(v));
const shekel = (v: number): string => `${n0(Math.abs(v))} ₪`;

export function requiredSeats(a: CompleteAnswers): number {
  if (a.passengers === "many") return a.seatsMin ?? 6;
  if (a.passengers === "three_five") return 5;
  return 2;
}

function fieldValue(spec: VehicleSpec, key: SpecFieldKey): number | null {
  const f = spec.fields[key];
  if (!f) return null;
  // רק filter/allowed משמשים לסינון/דירוג. display_only / display_family_only - לא.
  return f.use === "filter" || f.use === "allowed" ? f.value : null;
}

interface Compact { lb: number; ub: number; lengthText: string; widthText: string }

interface Cand {
  entry: CatalogEntry;
  spec: VehicleSpec;
  seats: number | null;
  cargo: { value: number; seatsInUse: number } | null;
  cargoIssue: string | null;
  compact: Compact | null;
  compactIssue: string | null;
  net: NetOutcome | null;
}

function buildCand(entry: CatalogEntry, spec: VehicleSpec, net: MatchEngineInput["net"]): Cand {
  const seats = fieldValue(spec, "seats");

  let cargo: Cand["cargo"] = null;
  let cargoIssue: string | null = null;
  const boot = fieldValue(spec, "bootRearSeatsUpL");
  if (!COMPARABLE_CARGO.has(spec.cargo.method)) {
    cargoIssue = spec.cargo.method === "tesla_behind_second_row"
      ? "נפח המטען נמדד בשיטה שונה משאר הרכבים ולכן אינו ברת־השוואה ישירה."
      : "נפח המטען לא אושר לגרסה הזו.";
  } else if (boot === null || spec.cargo.seatsInUse === null) {
    cargoIssue = spec.blocked.bootRearSeatsUpL?.reasonHe ?? "נפח המטען לא אושר לגרסה הזו.";
  } else {
    cargo = { value: boot, seatsInUse: spec.cargo.seatsInUse };
  }

  let compact: Compact | null = null;
  let compactIssue: string | null = null;
  const len = fieldValue(spec, "lengthMm");
  const wid = fieldValue(spec, "widthMm");
  const lenRange = spec.blocked.lengthMm?.range ?? null;
  if (wid === null) {
    compactIssue = "רוחב הרכב לא אושר לגרסה הזו.";
  } else if (len !== null) {
    compact = { lb: len * wid, ub: len * wid, lengthText: `${n0(len)} מ״מ`, widthText: `${n0(wid)} מ״מ` };
  } else if (lenRange) {
    // טווח מתועד: נשווה כטווח (קונסרבטיבית: חסם עליון לדירוג, חסם תחתון לקביעת הובלה).
    compact = {
      lb: lenRange[0] * wid, ub: lenRange[1] * wid,
      lengthText: `${n0(lenRange[0])}–${n0(lenRange[1])} מ״מ (לפי מקורות שונים)`, widthText: `${n0(wid)} מ״מ`,
    };
  } else {
    compactIssue = spec.blocked.lengthMm?.reasonHe ?? "אורך הרכב לא אושר לגרסה הזו.";
  }

  return { entry, spec, seats, cargo, cargoIssue, compact, compactIssue, net: net?.byVehicle[entry.id] ?? null };
}

const byId = (a: { entry: CatalogEntry }, b: { entry: CatalogEntry }): number =>
  a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0;

function netOk(c: Cand): c is Cand & { net: Extract<NetOutcome, { status: "ok" }> } {
  return c.net?.status === "ok";
}

/** קבוצת הנפחים בת-ההשוואה: אותה תצורת מושבים בשימוש. נבחרת הגדולה ביותר (שוויון: פחות מושבים). */
function dominantCargoGroup(cands: Cand[]): number | null {
  const counts = new Map<number, number>();
  for (const c of cands) if (c.cargo) counts.set(c.cargo.seatsInUse, (counts.get(c.cargo.seatsInUse) ?? 0) + 1);
  let best: number | null = null;
  for (const [seats, n] of counts) {
    if (best === null || n > (counts.get(best) ?? 0) || (n === (counts.get(best) ?? 0) && seats < best)) best = seats;
  }
  return best;
}

function cargoPool(cands: Cand[]): { pool: Cand[]; seatsInUse: number | null } {
  const g = dominantCargoGroup(cands);
  return { pool: cands.filter((c) => c.cargo && c.cargo.seatsInUse === g).sort(byId), seatsInUse: g };
}

const sortCargo = (l: Cand[]): Cand[] => [...l].sort((a, b) => b.cargo!.value - a.cargo!.value || byId(a, b));
const sortCompact = (l: Cand[]): Cand[] => [...l].sort((a, b) => a.compact!.ub - b.compact!.ub || byId(a, b));
const sortNet = (l: Cand[]): Cand[] =>
  [...l].sort((a, b) => netDelta(b) - netDelta(a) || byId(a, b));
function netDelta(c: Cand): number {
  return c.net?.status === "ok" ? c.net.netDelta : Number.NEGATIVE_INFINITY;
}

// ───────────── המנוע ─────────────

export function matchVehicles(input: MatchEngineInput): MatchResult {
  const { answers, eligibility, catalog, specs, net } = input;
  const base = { rankingBasis: "none" as RankingBasis, rankingNote: "", options: [], needsCheck: [], coverageNotes: [], emptyReason: null, eligibleCount: 0 };

  if (eligibility.group === null) {
    return { ...base, status: "needs_eligibility_group", netState: "needs_details", groupUsed: null };
  }

  const specMap = new Map(specs.map((s) => [s.id, s]));
  const need = requiredSeats(answers);
  const coverageNotes: string[] = [];
  const fit: Cand[] = [];
  const needsCheck: Array<{ cand: Cand; reason: string; missing: MissingField[] }> = [];
  let eligibleCount = 0;
  let blockedBySpec = 0;

  for (const entry of [...catalog].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const spec = specMap.get(entry.id);
    if (!spec) continue;
    const elig = input.eligibilityCheck(entry);
    if (elig === "ineligible") continue;
    if (!spec.automaticRecommendationEnabled) {
      if (elig === "eligible") blockedBySpec += 1;
      continue; // חסום להמלצה אוטומטית לפי מפרט חיצוני
    }
    const cand = buildCand(entry, spec, net);
    if (elig === "eligible") eligibleCount += 1;

    // דרישה הכרחית: מושבים
    if (cand.seats !== null && cand.seats < need) continue;
    if (cand.seats === null) {
      needsCheck.push({
        cand, reason: "מספר המושבים לא אושר לגרסה הזו, ולכן לא ניתן לדעת אם הוא עומד בדרישה שלך.",
        missing: [{ key: "seats", label: "מספר מושבים", reason: "לא אושר" }],
      });
      continue;
    }
    if (elig === "missing") {
      // זכאות למסלול ברוכי ילדים לא ידועה: מציגים כ"דורש בדיקה" רק כשהדרישה (6+ מקומות)
      // לא ניתנת לסיפוק ברכב רגיל. אחרת זה רעש - לא מוצג.
      if (need < 6) continue;
      needsCheck.push({
        cand, reason: "עומד בדרישת המושבים, אך הזכאות שלך לרכב הזה תלויה בפרט שחסר (מספר ילדים מזכים). נבדוק בשיחה.",
        missing: [{ key: "eligibility", label: "זכאות", reason: "חסר מספר ילדים מזכים למסלול ברוכי ילדים" }],
      });
      continue;
    }
    fit.push(cand);
  }

  if (blockedBySpec > 0) coverageNotes.push("לא דורג דגם אחד בגלל אי־התאמה במפרט המקור.");

  const netCtx = net;
  const anyNet = fit.some(netOk);
  const netState: MatchResult["netState"] = anyNet ? "available" : "needs_details";

  // ─── דירוג ───
  let ranked: Cand[] = [];
  let basis: RankingBasis = "none";
  let note = "";
  let usedCriteria: Criterion[] = [];
  const excluded = new Map<string, string>(); // מזהה -> סיבת אי-דירוג

  const cp = cargoPool(fit);
  const cargoPoolIds = new Set(cp.pool.map((c) => c.entry.id));
  const compactPool = fit.filter((c) => c.compact);
  const netPool = fit.filter(netOk);

  const cargoReason = (c: Cand): string =>
    c.cargoIssue ?? "נפח המטען שלו נמדד בתצורת מושבים שונה, ולכן אינו ברת־השוואה ישירה לאחרים.";
  const compactReason = (c: Cand): string => c.compactIssue ?? "המידות החיצוניות לא אושרו.";
  const netReason = (): string => "הפרש הנטו לא חושב לרכב הזה (חסרים פרטים).";

  const explainPool = (pool: Cand[], why: (c: Cand) => string): void => {
    const ids = new Set(pool.map((p) => p.entry.id));
    for (const c of fit) if (!ids.has(c.entry.id)) excluded.set(c.entry.id, why(c));
  };

  if (fit.length > 0) {
    switch (answers.priority) {
      case "net":
        if (netPool.length >= 1) {
          ranked = sortNet(netPool); basis = "net"; usedCriteria = ["net"];
          note = "מסודר לפי הפרש הנטו מול הרכב הנוכחי שלך, לפי ההנחות המפורטות בכל כרטיס.";
          explainPool(netPool, netReason);
        }
        break;
      case "cargo":
        if (cp.pool.length >= 1) {
          ranked = sortCargo(cp.pool); basis = "cargo"; usedCriteria = ["cargo"];
          note = "מסודר לפי נפח המטען המוצהר באותה תצורת מושבים. שיטות המדידה של היצרנים אינן בהכרח זהות.";
          explainPool(cp.pool, cargoReason);
        }
        break;
      case "compact":
        if (compactPool.length >= 1) {
          ranked = sortCompact(compactPool); basis = "compact"; usedCriteria = ["compact"];
          note = "מסודר לפי מידות חיצוניות מאומתות (אורך ורוחב). המידות אינן מוכיחות קלות חניה או נוחות.";
          explainPool(compactPool, compactReason);
        }
        break;
      default:
        break;
    }

    // איזון - או נפילה לאיזון כשהעדפה מובילה אחרת חסרת נתונים
    if (ranked.length === 0) {
      const sets = balancedCriteriaSet(fit, netPool, cp.pool, compactPool);
      if (sets) {
        usedCriteria = sets.criteria;
        ranked = scoreBalanced(sets.pool, sets.criteria);
        const names = usedCriteria.map((c) => CRITERION_LABEL[c]).join(", ");
        if (answers.priority === "balanced") {
          basis = "balanced";
          note = `מסודר באיזון בין ${names}. המשקולות הן בחירת מוצר ולא מדד מדעי.`;
        } else {
          basis = "balanced_fallback";
          note = `עדיין אי אפשר לדרג לפי ${priorityLabel(answers.priority)} (חסרים נתונים בני־השוואה), ולכן הדירוג מבוסס על ${names}.`;
        }
        const ids = new Set(sets.pool.map((p) => p.entry.id));
        for (const c of fit) {
          if (ids.has(c.entry.id)) continue;
          const miss: string[] = [];
          if (usedCriteria.includes("cargo") && !cargoPoolIds.has(c.entry.id)) miss.push(cargoReason(c));
          if (usedCriteria.includes("compact") && !c.compact) miss.push(compactReason(c));
          if (usedCriteria.includes("net") && !netOk(c)) miss.push(netReason());
          excluded.set(c.entry.id, miss.join(" ") || "חסרים נתונים בני־השוואה.");
        }
      }
    }
  }

  // פחות משתיים בר-השוואה => אין דירוג ואין מנצח
  let comparablePool = ranked.length;
  if (ranked.length === 0 && fit.length > 0) {
    // אין בסיס דירוג כלל: אפשרויות לבחינה, ללא סדר מועדף
    ranked = [...fit].sort(byId);
    basis = "none";
    note = "אין מספיק נתונים מאושרים כדי לדרג אמין. אלה אפשרויות לבחינה, ללא סדר מועדף.";
    comparablePool = 0;
    excluded.clear();
  } else if (ranked.length === 1) {
    note += " נמצאה רק אפשרות אחת שניתן להשוות, ולכן אין כאן דירוג.";
  }

  // הובלות מאומתות (לתגיות) - מחושבות על מאגר בר-השוואה, לא על בסיס הדירוג הנבחר
  const leads = computeLeads(fit, cp.pool, netPool, compactPool);

  const shown = ranked.slice(0, MAX_OPTIONS);
  const rest = ranked.length - shown.length;
  if (rest > 0) coverageNotes.push(`יש עוד ${rest} אפשרויות מתאימות ברשימת הזכאות שלך; הצגנו את ${shown.length} הראשונות לפי הסדר שלמעלה.`);

  const ctx: Ctx = { answers, input, cargoRanked: sortCargo(cp.pool), compactRanked: sortCompact(compactPool), netRanked: sortNet(netPool), netCtx, leads, basis };
  const options = shown.map((c) => toOption(c, ctx, comparablePool >= 2));

  // דורשים בדיקה: חסרי נתון לדירוג + חסרי נתון הכרחי/זכאות
  const checkList: MatchOption[] = [];
  // מועמדים שהוצאו מהדירוג בגלל נתון חסר (לא חתכו בגלל מגבלת ה-3)
  for (const c of fit) {
    const reason = excluded.get(c.entry.id);
    if (reason && !checkList.some((o) => o.vehicleId === c.entry.id)) checkList.push(toOption(c, ctx, false, reason));
  }
  for (const nc of needsCheck) {
    const o = toOption(nc.cand, ctx, false, nc.reason);
    o.missingFields = nc.missing;
    checkList.push(o);
  }
  const needsCheckOut = checkList.slice(0, MAX_NEEDS_CHECK);
  if (checkList.length > needsCheckOut.length) {
    coverageNotes.push(`עוד ${checkList.length - needsCheckOut.length} אפשרויות דורשות בדיקה ולא הוצגו כאן.`);
  }

  let emptyReason: string | null = null;
  if (options.length === 0 && needsCheckOut.length === 0) {
    emptyReason = need >= 6
      ? `ברשימת הרכבים שבזכאות שלך אין רכב עם ${need} מקומות לפחות (כולל הנהג).`
      : "לא נמצאו רכבים שעומדים בדרישות ובזכאות שלך.";
  }

  return {
    status: "ok",
    rankingBasis: options.length === 0 ? "none" : basis,
    rankingNote: options.length === 0 ? "" : note.trim(),
    options,
    needsCheck: needsCheckOut,
    coverageNotes,
    emptyReason,
    netState,
    eligibleCount,
    groupUsed: eligibility.group,
  };
}

function priorityLabel(p: CompleteAnswers["priority"]): string {
  return p === "net" ? "נטו" : p === "cargo" ? "נפח מטען" : p === "compact" ? "מידות" : "איזון";
}

// ───────────── איזון: קבוצת קריטריונים משותפת ─────────────

function balancedCriteriaSet(
  fit: Cand[], netPool: Cand[], cargoP: Cand[], compactP: Cand[],
): { criteria: Criterion[]; pool: Cand[] } | null {
  const avail: Array<[Criterion, Set<string>]> = [];
  if (netPool.length > 0) avail.push(["net", new Set(netPool.map((c) => c.entry.id))]);
  if (cargoP.length > 0) avail.push(["cargo", new Set(cargoP.map((c) => c.entry.id))]);
  if (compactP.length > 0) avail.push(["compact", new Set(compactP.map((c) => c.entry.id))]);
  if (avail.length === 0) return null;

  // כל תת-קבוצה לא ריקה של הקריטריונים הזמינים
  const subsets: Array<Array<[Criterion, Set<string>]>> = [];
  for (let mask = 1; mask < 1 << avail.length; mask++) {
    subsets.push(avail.filter((_, i) => mask & (1 << i)));
  }
  const want = Math.min(MAX_OPTIONS, fit.length);
  const evaluated = subsets.map((s) => {
    const pool = fit.filter((c) => s.every(([, ids]) => ids.has(c.entry.id)));
    return { criteria: s.map(([k]) => k), pool };
  });
  // עדיפות: הקבוצה הרחבה ביותר שמכסה לפחות `want` רכבים; אחרת הכיסוי הגדול ביותר.
  const enough = evaluated.filter((e) => e.pool.length >= want).sort((a, b) => b.criteria.length - a.criteria.length || b.pool.length - a.pool.length);
  if (enough.length > 0) return enough[0]!;
  const best = evaluated.sort((a, b) => b.pool.length - a.pool.length || b.criteria.length - a.criteria.length)[0]!;
  return best.pool.length > 0 ? best : null;
}

function scoreBalanced(pool: Cand[], criteria: Criterion[]): Cand[] {
  const wsum = criteria.reduce((s, c) => s + BALANCED_WEIGHTS[c], 0);
  const raw = (c: Cand, k: Criterion): number =>
    k === "net" ? netDelta(c) : k === "cargo" ? c.cargo!.value : -c.compact!.ub; // גדול = טוב
  const norm = new Map<Criterion, { min: number; max: number }>();
  for (const k of criteria) {
    const vals = pool.map((c) => raw(c, k));
    norm.set(k, { min: Math.min(...vals), max: Math.max(...vals) });
  }
  const score = (c: Cand): number =>
    criteria.reduce((s, k) => {
      const { min, max } = norm.get(k)!;
      const v = max === min ? 1 : (raw(c, k) - min) / (max - min);
      return s + (BALANCED_WEIGHTS[k] / wsum) * v;
    }, 0);
  const scored = pool.map((c) => ({ c, s: score(c) }));
  scored.sort((a, b) => b.s - a.s || byId(a.c, b.c));
  return scored.map((x) => x.c);
}

// ───────────── הובלות מאומתות לתגיות ─────────────

type Leads = Partial<Record<Criterion, string>>;

function computeLeads(_fit: Cand[], cargoP: Cand[], netPool: Cand[], compactP: Cand[]): Leads {
  const leads: Leads = {};
  if (cargoP.length >= 2) {
    const s = sortCargo(cargoP);
    if (s[0]!.cargo!.value > s[1]!.cargo!.value) leads.cargo = s[0]!.entry.id;
  }
  if (netPool.length >= 2) {
    const s = sortNet(netPool);
    if (netDelta(s[0]!) > netDelta(s[1]!) && netDelta(s[0]!) > 0) leads.net = s[0]!.entry.id;
  }
  if (compactP.length >= 2) {
    const s = sortCompact(compactP);
    if (s[0]!.compact!.ub < s[1]!.compact!.lb) leads.compact = s[0]!.entry.id;
  }
  return leads;
}

// ───────────── בניית כרטיס ─────────────

interface Ctx {
  answers: CompleteAnswers;
  input: MatchEngineInput;
  cargoRanked: Cand[];
  compactRanked: Cand[];
  netRanked: Cand[];
  netCtx: MatchEngineInput["net"];
  leads: Leads;
  basis: RankingBasis;
}

const ordinal = (i: number, n: number): string =>
  i === 0 ? `הראשון מבין ${n}` : `מקום ${i + 1} מבין ${n}`;

function toOption(c: Cand, ctx: Ctx, allowBadges: boolean, checkReason?: string): MatchOption {
  const { answers, input } = ctx;
  const spec = c.spec;
  const e = c.entry;
  const isEv = e.propulsion === 3;
  const isPlugin = e.propulsion === 2;
  const reasons: Reason[] = [];
  const considerations: string[] = [];
  const missing: MissingField[] = [];

  // ── נטו ──
  const netOutcome = c.net;
  let netOut: MatchOption["net"] = { status: "unavailable" };
  if (netOutcome?.status === "ok") {
    netOut = {
      status: "ok", netDelta: netOutcome.netDelta, baselineName: ctx.netCtx?.baselineName ?? null,
      assumptions: dedupe([...(ctx.netCtx?.baselineAssumptions ?? []), ...netOutcome.assumptions]),
    };
  } else {
    missing.push({ key: "net", label: "הפרש נטו", reason: "נשלים כמה פרטים בשיחה" });
  }

  // ── סיבות (מבוססות נתונים) ──
  const cargoRank = ctx.cargoRanked.findIndex((x) => x.entry.id === e.id);
  const compactRank = ctx.compactRanked.findIndex((x) => x.entry.id === e.id);
  const netRank = ctx.netRanked.findIndex((x) => x.entry.id === e.id);

  const has = (code: string): boolean => reasons.some((r) => r.code === code);
  const pushNetReason = (): void => {
    if (!has("net_gain") && netOutcome?.status === "ok" && netOutcome.netDelta > 0) {
      reasons.push({ code: "net_gain", text: `משאיר בנטו כ־${shekel(netOutcome.netDelta)} יותר בחודש מהרכב הנוכחי שלך` +
        (netRank >= 0 && ctx.netRanked.length > 1 ? ` (${ordinal(netRank, ctx.netRanked.length)} בהפרש הנטו)` : "") });
    }
  };
  const pushCargoReason = (): void => {
    if (c.cargo && !has("cargo_volume")) {
      reasons.push({ code: "cargo_volume", text: `נפח מטען מוצהר של ${n0(c.cargo.value)} ליטר` +
        (cargoRank >= 0 && ctx.cargoRanked.length > 1 ? ` (${ordinal(cargoRank, ctx.cargoRanked.length)} בנפח המטען המוצהר)` : "") });
    }
  };
  const pushCompactReason = (): void => {
    if (c.compact && !has("compact_dims")) {
      reasons.push({ code: "compact_dims", text: `מידות חיצוניות: אורך ${c.compact.lengthText}, רוחב ${c.compact.widthText}` +
        (compactRank >= 0 && ctx.compactRanked.length > 1 ? ` (${ordinal(compactRank, ctx.compactRanked.length)} בקטנות המידות)` : "") });
    }
  };

  const p = answers.priority;
  if (p === "net") pushNetReason();
  else if (p === "cargo") pushCargoReason();
  else if (p === "compact") pushCompactReason();
  else {
    // איזון: עובדות מהקריטריונים הזמינים שבהם הרכב משתתף (בלי ציון).
    pushCargoReason(); pushCompactReason(); pushNetReason();
    if (reasons.length === 0) {
      reasons.push({ code: "balanced", text: "משתלב באיזון לפי הנתונים הזמינים" });
    }
  }

  if (answers.passengers === "many" && c.seats !== null) {
    reasons.push({ code: "seats_required", text: `${c.seats} מקומות כולל הנהג, בהתאם לדרישה שלך (לפחות ${requiredSeats(answers)})` });
  } else if (answers.passengers === "three_five" && c.seats !== null) {
    reasons.push({ code: "seats_five", text: `${c.seats} מקומות כולל הנהג` });
  }
  if ((answers.cargo === "stroller" || answers.cargo === "lots") && p !== "cargo") pushCargoReason();
  if (p !== "net") pushNetReason();
  if ((isEv || isPlugin) && answers.charging === "home_work") {
    reasons.push({ code: "charging_ok", text: "מתאים לאפשרות הטעינה הנוחה שציינת (בבית או בעבודה)" });
  }

  // ── שיקולים ──
  for (const note of spec.notesHe) considerations.push(note);
  if (c.net?.status === "ok" && c.net.netDelta < 0) {
    considerations.push(`משאיר בנטו כ־${shekel(c.net.netDelta)} פחות בחודש מהרכב הנוכחי שלך`);
  }
  if (isEv && (answers.charging === "none" || answers.charging === "public" || answers.charging === "unsure")) {
    considerations.push(answers.charging === "unsure"
      ? "ברכב חשמלי כדאי לברר לפני ההחלטה איפה ואיך אפשר להטעין בשגרה"
      : "ברכב חשמלי בלי טעינה נוחה כדאי לבדוק את שגרת הטעינה בעמדות ציבוריות; לא חישבנו עלות טעינה");
  }
  if (isPlugin && answers.charging !== "home_work") {
    considerations.push("ברכב פלאג־אין כדאי לבדוק איך להטעין אותו בשגרה");
  }
  const range = fieldValue(spec, "rangeWltpKm");
  if (isEv && answers.trips !== "city") {
    if (range !== null) {
      if (answers.trips === "long") {
        considerations.push(`טווח מעבדה מוצהר של ${n0(range)} ק״מ (WLTP); בנסיעות ארוכות כדאי לבדוק טווח בפועל ותחנות טעינה בדרך`);
      }
    } else {
      missing.push({ key: "rangeWltpKm", label: "טווח נסיעה", reason: spec.blocked.rangeWltpKm?.reasonHe ?? "לא אושר" });
      considerations.push("טווח הנסיעה לא אושר לגרסה הזו; כדאי לברר אותו לפני החלטה");
    }
  }
  if (answers.cargo === "stroller") considerations.push("נפח מטען עוזר להשוות; התאמה לעגלה מסוימת כדאי לבדוק ברכב");
  if (answers.cargo === "lots") considerations.push("בציוד רב ובקבוע כדאי לבדוק את המטען בפועל ברכב, לא רק לפי ליטרים");
  if (!c.cargo && (p === "cargo" || answers.cargo !== "bag")) {
    missing.push({ key: "bootRearSeatsUpL", label: "נפח מטען", reason: c.cargoIssue ?? "לא אושר" });
    if (c.cargoIssue) considerations.push(c.cargoIssue);
  }
  if (c.cargo && (answers.cargo === "stroller" || answers.cargo === "lots") && ctx.cargoRanked.length >= 4) {
    if (cargoRank >= Math.ceil(ctx.cargoRanked.length * 0.75)) {
      considerations.push("נפח המטען המוצהר שלו נמוך יחסית בין האפשרויות שבזכאות שלך");
    }
  }
  if ((p === "compact" || p === "balanced") && spec.blocked.lengthMm?.range) {
    considerations.push(`אורך הרכב נע בין ${spec.blocked.lengthMm.range[0]} ל־${spec.blocked.lengthMm.range[1]} מ״מ לפי מקורות שונים`);
  }
  if (c.cargo && spec.cargo.seatsInUse !== null && spec.cargo.seatsInUse > 5) {
    considerations.push(`נפח המטען נמדד כשכל ${spec.cargo.seatsInUse} המושבים בשימוש`);
  }

  // ── מפרטים רלוונטיים בלבד ──
  const specs: DisplaySpec[] = [];
  const addSpec = (key: SpecFieldKey, label: string, text: string, note?: string): void => {
    const f = spec.fields[key];
    if (!f) return;
    const d: DisplaySpec = { key, label, valueText: text, sourceIds: f.evidence.sourceIds };
    if (note) d.note = note;
    specs.push(d);
  };
  if (c.seats !== null) addSpec("seats", "מושבים (כולל הנהג)", String(c.seats));
  if (c.cargo && (p === "cargo" || p === "balanced" || answers.cargo !== "bag")) {
    const method = spec.cargo.method === "vda_beltline" ? "נמדד בשיטת VDA" : "שיטת המדידה לא פורטה; השוואה משוערת בין יצרנים";
    addSpec("bootRearSeatsUpL", "נפח מטען מוצהר", `${n0(c.cargo.value)} ליטר`, method);
    const frunk = fieldValue(spec, "frunkL");
    if (frunk !== null) addSpec("frunkL", "תא קדמי (נפרד)", `${n0(frunk)} ליטר`);
  } else if (spec.fields.bootRearSeatsUpL?.use === "display_only" && (p === "cargo" || answers.cargo !== "bag")) {
    addSpec("bootRearSeatsUpL", "נפח מטען (שיטת Tesla)", `${n0(spec.fields.bootRearSeatsUpL.value)} ליטר`, "שיטת מדידה שונה; אינו מושווה לאחרים");
    const frunk = fieldValue(spec, "frunkL");
    if (frunk !== null) addSpec("frunkL", "תא קדמי (נפרד)", `${n0(frunk)} ליטר`);
  }
  if (c.compact && (p === "compact" || p === "balanced")) {
    addSpec("lengthMm", "אורך", c.compact.lengthText);
    addSpec("widthMm", "רוחב", c.compact.widthText);
    if (!spec.fields.lengthMm && spec.blocked.lengthMm?.range) {
      specs.push({ key: "lengthMm", label: "אורך", valueText: c.compact.lengthText, sourceIds: spec.fields.widthMm?.evidence.sourceIds ?? [] });
    }
  }
  if (isEv && range !== null && (answers.trips !== "city" || answers.charging !== "home_work")) {
    addSpec("rangeWltpKm", "טווח מעבדה מוצהר (WLTP)", `${n0(range)} ק״מ`, "אינו מבטיח טווח בפועל");
  }
  // מסירת כפילות (אורך שנוסף פעמיים)
  const seen = new Set<string>();
  const specsOut = specs.filter((s) => (seen.has(s.key) ? false : (seen.add(s.key), true)));

  // ── מקורות ──
  const srcIds = dedupe(specsOut.flatMap((s) => s.sourceIds));
  if (srcIds.length === 0 && spec.fields.seats) srcIds.push(...spec.fields.seats.evidence.sourceIds);
  const sources = srcIds.map((id) => input.sources[id]).filter((s): s is SpecSource => !!s);

  // ── תגיות (רק עם בסיס השוואתי מאומת) ──
  const badges: Array<{ code: BadgeCode; text: string }> = [];
  if (allowBadges) {
    if (ctx.leads.cargo === e.id) badges.push({ code: "cargo_lead", text: "בולט במטען" });
    if (ctx.leads.net === e.id) badges.push({ code: "net_lead", text: "משאיר יותר נטו" });
    if (ctx.leads.compact === e.id) badges.push({ code: "compact_lead", text: "מידות קטנות" });
  }

  const option: MatchOption = {
    vehicleId: e.id,
    name: e.name,
    group: e.group,
    propulsionLabel: PROPULSION_LABEL[e.propulsion],
    bodyType: spec.registry?.bodyType ?? null,
    reasons: reasons.slice(0, 2),
    considerations: dedupe(considerations),
    missingFields: dedupeMissing(missing),
    specs: specsOut.slice(0, 5),
    sources,
    badges,
    net: netOut,
  };
  if (checkReason) option.checkReason = checkReason;
  return option;
}

function dedupe<T>(l: T[]): T[] { return [...new Set(l)]; }
function dedupeMissing(l: MissingField[]): MissingField[] {
  const seen = new Set<string>();
  return l.filter((m) => (seen.has(m.key) ? false : (seen.add(m.key), true)));
}
