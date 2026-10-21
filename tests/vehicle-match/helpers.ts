// tests/vehicle-match/helpers.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOG } from "../../data/source/catalog.js";
import { SPEC_SOURCES, VEHICLE_SPECS } from "../../data/source/vehicle-specs.js";
import { parseRules } from "../../src/domain/calculation/rule-set-loader.js";
import { makeEligibilityCheck } from "../../src/domain/vehicle-match/eligibility.js";
import type {
  CatalogEntry, CompleteAnswers, MatchEngineInput, NetContext, VehicleSpec,
} from "../../src/domain/vehicle-match/types.js";

export const RULES = parseRules(readFileSync(join(process.cwd(), "data", "source", "strauss-rules.json"), "utf8")).rules;

const PROP = (t: string): 0 | 1 | 2 | 3 => (t.includes("חשמלי") ? 3 : t.includes("פלאג") ? 2 : t.includes("היבריד") ? 1 : 0);

export const CATALOG_ENTRIES: CatalogEntry[] = CATALOG.map((v) => ({
  id: v.id, name: v.commercialName, group: v.group, propulsion: PROP(v.propulsionText),
}));

export const ANSWERS: CompleteAnswers = {
  passengers: "three_five", seatsMin: null, cargo: "bag", trips: "mixed", charging: "home_work", priority: "balanced",
};

export function input(opts: {
  group: string | null;
  children?: number | null;
  answers?: Partial<CompleteAnswers>;
  net?: NetContext | null;
  specs?: VehicleSpec[];
  catalog?: CatalogEntry[];
}): MatchEngineInput {
  const group = opts.group;
  const occupation = group
    ? { code: "reported", name: "x", group, carMandatory: false, waiverAllowed: false, maintenanceAllowance: 0 }
    : null;
  const children = opts.children ?? null;
  return {
    answers: { ...ANSWERS, ...opts.answers },
    eligibility: { group, qualifyingChildren: children },
    eligibilityCheck: makeEligibilityCheck(RULES, occupation, children),
    catalog: opts.catalog ?? CATALOG_ENTRIES,
    specs: opts.specs ?? VEHICLE_SPECS,
    sources: SPEC_SOURCES,
    net: opts.net ?? null,
  };
}

export function netCtx(deltas: Record<string, number>, baselineName = "COROLLA CROSS"): NetContext {
  const byVehicle: NetContext["byVehicle"] = {};
  for (const [id, d] of Object.entries(deltas)) {
    byVehicle[id] = { status: "ok", net: 11000 + d, netDelta: d, assumptions: [`השתתפות ברכב לא נמסרה; נלקחה ברירת המחדל של הדגם.`] };
  }
  return { baselineName, baselineNet: 11000, baselineAssumptions: [], byVehicle, caseMissingFields: [] };
}

export function cloneSpecs(mutate: (specs: VehicleSpec[]) => void): VehicleSpec[] {
  const copy = JSON.parse(JSON.stringify(VEHICLE_SPECS)) as VehicleSpec[];
  mutate(copy);
  return copy;
}
