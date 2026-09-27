/**
 * LOCAL REHEARSAL DATASET — synthetic reference data for the technical pilot rehearsal (M6 STEP 6) ONLY.
 *
 * What it is: the repository's in-code engine objects (the KIT_BASE_STANDARD recipe and product, the catalog
 * materials, the TEST_FIXTURE construction / planning / edge-band / Hettich / pricing / quotation fixtures) re-issued as
 * intake files so that the REAL intake, approval workflow, engines and API can be exercised end-to-end.
 *
 * What it is NOT: Lintel values, Hettich data, supplier prices or a tax position. Every file names the marker below
 * in its source, every entity carries the REHEARSAL prefix where the domain lets it, and the loader
 * (./rehearsal.ts) refuses any database that is not a loopback `lintel_rehearsal*` database and any organization other
 * than REHEARSAL_ORG. `pilot:check` fails BLOCKING if the marker is ever found in a staging or production database.
 * The TEST_FIXTURE objects themselves are never imported: the intake refuses them (their status / classification /
 * FIXTURE-* codes), so this module re-states their values under the marker.
 */
import { EDGE_BANDS, FINISHES, KIT_BASE_STANDARD, KITCHEN_BASE_STANDARD_V1, MATERIALS, HINGE_STANDARD,
  DRAWER_STANDARD, KIT_BASE_DRAWER, KITCHEN_BASE_DRAWER_V1,
  OPEN_STANDARD, KIT_BASE_OPEN, KITCHEN_BASE_OPEN_V1,
  PULLOUT_STANDARD, KIT_BASE_PULLOUT, KITCHEN_BASE_PULLOUT_V1,
  SINK_STANDARD, KIT_BASE_SINK, KITCHEN_BASE_SINK_V1,
  APPLIANCES, OVEN_TOWER_STANDARD, KIT_TALL_OVEN, KITCHEN_TALL_OVEN_V1,
  TEST_FIXTURE_CONSTRUCTION_STANDARD, TEST_FIXTURE_EDGE_BAND_STANDARD, TEST_FIXTURE_PLANNING_STANDARD } from "@lintel/catalog-engine";
import { HETTICH_TEST_FIXTURE_DATASET } from "@lintel/hettich-engine";
import type { HettichProductionDataset, HettichProductionRecord } from "@lintel/hettich-engine";
import { TEST_FIXTURE_PRICING_RULES, TEST_FIXTURE_QUOTATION_POLICY, TEST_FIXTURE_RATE_CARD } from "@lintel/pricing-engine";
import type { ProductDefinition } from "@lintel/types";
import type { IntakeType } from "../intake/spec.js";
import { INTAKE_FORMAT } from "../intake/spec.js";

export const REHEARSAL_MARKER = "LOCAL REHEARSAL ONLY";
export const REHEARSAL_SOURCE = `${REHEARSAL_MARKER} — synthetic value re-stated from a repository test fixture; not a Lintel, Hettich or supplier value`;
export const REHEARSAL_ORG = "LOCAL-REHEARSAL";
const DATE = "2026-09-26";
/** The Hettich validator accepts only hettich.com URLs; this path names itself as not being a Hettich record. */
const HETTICH_PLACEHOLDER_URL = "https://www.hettich.com/local-rehearsal-synthetic-not-a-hettich-record";

export type Role = "PRODUCTION" | "DESIGN_HEAD" | "PROCUREMENT" | "COSTING" | "FINANCE";

export interface RehearsalFile {
  readonly type: IntakeType;
  readonly entityCode: string;
  /** Who authors (imports, submits) and who approves: the database's default grants, author ≠ approver. */
  readonly author: Role;
  readonly approver: Role;
  readonly file: Record<string, unknown>;
}

const sourceRef = { url: null, documentTitle: `${REHEARSAL_MARKER}: rehearsal dataset`, documentVersion: "1", sourceDate: DATE };
function intake(type: IntakeType, entityCode: string, data: unknown, author: Role, approver: Role, extra: Record<string, unknown> = {}): RehearsalFile {
  return {
    type, entityCode, author, approver,
    file: {
      format: INTAKE_FORMAT, type, classification: "PRODUCTION", intent: "PRODUCTION_CANDIDATE", entityCode, versionNumber: 1,
      changeReason: `${REHEARSAL_MARKER}: technical rehearsal`, source: REHEARSAL_SOURCE, sourceRef, data, ...extra,
    },
  };
}
const provenance = (vars: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(Object.keys(vars).map((k) => [k, { unit: "MM", source: REHEARSAL_SOURCE, evidenceRef: REHEARSAL_MARKER, note: REHEARSAL_MARKER }]));
const catalog = (label: string, members: readonly (readonly [string, string])[]) =>
  ({ versionLabel: label, description: `${REHEARSAL_MARKER}: ${label}`, members: members.map(([itemType, entityCode]) => ({ itemType, entityCode, versionNumber: 1 })) });

/** Rehearsal-only completions of the catalog values the repository leaves NULL (never Lintel values). */
const MATERIAL_FILL = { sheetSize: { width: 1220, height: 2440 }, grain: false, densityKgPerM3: 700, substrate: "Rehearsal substrate" } as const;
const PRODUCT_LIMITS: Readonly<Record<string, readonly [number, number]>> = {
  width: [300, 1200], height: [500, 900], depth: [300, 650], carcassThickness: [16, 19], backThickness: [4, 9], shelfCount: [0, 3], shutterCount: [1, 2], drawerCount: [2, 4],
  drawerHeight1: [100, 400], drawerHeight2: [100, 400], drawerHeight3: [100, 400],
  pulloutCount: [1, 4],
  shelfCountAbove: [0, 3],
};

function hettichRecord(a: (typeof HETTICH_TEST_FIXTURE_DATASET.articles)[number]): HettichProductionRecord {
  const src = { url: HETTICH_PLACEHOLDER_URL, sourceDate: DATE, documentTitle: REHEARSAL_SOURCE, documentVersion: "1" };
  const article = a.articleNumber.replace(/^FIXTURE-/, "REHEARSAL-");
  const hinge = a.category === "HINGE";
  return {
    recordId: `REC-${article}`, articleNumber: article, productFamily: a.family.replace(/^FIXTURE_/, "REHEARSAL_"), series: null, category: a.category,
    description: `${a.description} (${REHEARSAL_MARKER})`,
    exactApplication: { description: REHEARSAL_MARKER, application: a.application, mounting: a.mounting },
    dimensions: { REHEARSAL: { value: 1, unit: "MM" } },
    compatibility: {
      doorThicknessRange: a.doorThicknessRange, openingAngle: a.openingAngle, nominalLength: a.nominalLength,
      compatibleArticles: a.compatibleArticles.map((c) => c.replace(/^FIXTURE-/, "REHEARSAL-")), notes: REHEARSAL_MARKER,
    },
    drilling: hinge
      ? { patternId: "REHEARSAL-DRILL-CUP", holes: [{ face: "INSIDE", datum: "TOP", x: 22, y: 100, diameter: 35, depth: 12 }], source: src }
      : { patternId: null, holes: null, source: null },
    installation: { guide: src, notes: null },
    adjustment: { ranges: hinge ? { SIDE: { min: -2, max: 2, unit: "MM" } } : null, notes: null },
    accessories: [],
    cadReference: { assetId: `CAD-${article}`, formats: ["STEP"], url: HETTICH_PLACEHOLDER_URL },
    source: src,
    licence: { status: "AUTHORISED", usageNotes: REHEARSAL_MARKER },
    verification: { verifiedBy: REHEARSAL_MARKER, verifiedAt: DATE },
    preferenceRank: a.preferenceRank,
  };
}

export function rehearsalHettichDataset(): HettichProductionDataset {
  const f = HETTICH_TEST_FIXTURE_DATASET;
  const src = { url: HETTICH_PLACEHOLDER_URL, sourceDate: DATE, documentTitle: REHEARSAL_SOURCE, documentVersion: "1" };
  return {
    kind: "PRODUCTION", datasetId: "REHEARSAL_HETTICH", sourceVersion: "rehearsal-1", notes: REHEARSAL_SOURCE,
    records: f.articles.map(hettichRecord),
    calculationRules: f.calculationRules.map((r) => ({
      ...r, ruleId: r.ruleId.replace(/^FIXTURE-/, "REHEARSAL-"), family: r.family.replace(/^FIXTURE_/, "REHEARSAL_"), description: REHEARSAL_SOURCE,
      source: src, verification: { verifiedBy: REHEARSAL_MARKER, verifiedAt: DATE }, sourceVersion: "rehearsal-1",
    })),
  };
}

/** Every intake file of the rehearsal, in dependency order (each approved before the next that needs it). */
export function rehearsalDataset(): RehearsalFile[] {
  const construction = { ...TEST_FIXTURE_CONSTRUCTION_STANDARD, standardId: "REHEARSAL_CONSTRUCTION_STANDARD", status: "DRAFT", source: REHEARSAL_SOURCE, description: `${REHEARSAL_MARKER}: construction values` };
  const planning = { ...TEST_FIXTURE_PLANNING_STANDARD, standardId: "REHEARSAL_PLANNING_STANDARD", status: "DRAFT", source: REHEARSAL_SOURCE, description: `${REHEARSAL_MARKER}: planning values` };
  const edgeRules = { ...TEST_FIXTURE_EDGE_BAND_STANDARD, standardId: "REHEARSAL_EDGE_BAND_STANDARD", status: "DRAFT", source: REHEARSAL_SOURCE, description: `${REHEARSAL_MARKER}: edge rules` };
  const withLimits = (def: ProductDefinition, overrides?: Readonly<Record<string, readonly [number, number]>>): ProductDefinition => ({
    ...def,
    parameters: def.parameters.map((p) => {
      const lim = overrides?.[p.key] ?? PRODUCT_LIMITS[p.key];
      return (p.kind === "number" || p.kind === "integer") && lim !== undefined ? { ...p, min: lim[0], max: lim[1] } : p;
    }),
  });
  const product = withLimits(KIT_BASE_STANDARD);
  const productDrawer = withLimits(KIT_BASE_DRAWER);
  const productOpen = withLimits(KIT_BASE_OPEN);
  const productPullout = withLimits(KIT_BASE_PULLOUT);
  // KIT_TALL_OVEN is a tall cabinet (default height 2000 mm): the shared PRODUCT_LIMITS["height"] range
  // ([500, 900]) is for BASE-height cabinets only and must not be applied here, or the product's own default
  // height is rejected as out of range before the object can ever be resolved.
  const productOven = withLimits(KIT_TALL_OVEN, { height: [1800, 2400] });
  const productSink = withLimits(KIT_BASE_SINK);
  const rate = TEST_FIXTURE_RATE_CARD;
  const hardwarePerUnit = Object.fromEntries(Object.entries(rate.hardwarePerUnit).map(([k, v]) => [k.replace(":FIXTURE-", ":REHEARSAL-"), v]));
  const q = TEST_FIXTURE_QUOTATION_POLICY;

  return [
    intake("construction_standard", construction.standardId, construction, "PRODUCTION", "DESIGN_HEAD", { provenance: provenance(construction.variables) }),
    intake("planning_standard", planning.standardId, planning, "PRODUCTION", "DESIGN_HEAD", { provenance: provenance(planning.variables) }),
    ...MATERIALS.map((m) => intake("material", m.materialId, {
      ...m, source: REHEARSAL_SOURCE, substrate: m.substrate ?? MATERIAL_FILL.substrate, sheetSize: m.sheetSize ?? MATERIAL_FILL.sheetSize,
      grain: m.grain ?? MATERIAL_FILL.grain, densityKgPerM3: m.densityKgPerM3 ?? MATERIAL_FILL.densityKgPerM3,
    }, "PROCUREMENT", "DESIGN_HEAD")),
    ...EDGE_BANDS.map((b) => intake("edge_band", b.edgeBandId, { ...b, source: REHEARSAL_SOURCE, width: b.width ?? 22 }, "PROCUREMENT", "DESIGN_HEAD")),
    ...FINISHES.map((f) => intake("finish", f.finishId, { ...f, source: REHEARSAL_SOURCE }, "PROCUREMENT", "DESIGN_HEAD")),
    // WORKING_DRAFT, not PRODUCTION_CANDIDATE: OVEN_REFERENCE_60CM genuinely has make/model/ventilation left
    // NULL this slice (a plausible V1 reference value, not a manufacturer-verified spec — see
    // packages/catalog-engine/src/data/appliances.ts), so it cannot pass the PRODUCTION_CANDIDATE completeness
    // gate; WORKING_DRAFT still submits and approves normally.
    ...APPLIANCES.map((a) => intake("appliance", a.applianceId, { ...a, source: REHEARSAL_SOURCE }, "PROCUREMENT", "DESIGN_HEAD", { intent: "WORKING_DRAFT" })),
    intake("edge_band_standard", edgeRules.standardId, edgeRules, "PRODUCTION", "DESIGN_HEAD"),
    intake("hardware_rule_set", HINGE_STANDARD.ruleSetId, HINGE_STANDARD, "PROCUREMENT", "PRODUCTION"),
    intake("hardware_rule_set", DRAWER_STANDARD.ruleSetId, DRAWER_STANDARD, "PROCUREMENT", "PRODUCTION"),
    // WORKING_DRAFT, not PRODUCTION_CANDIDATE: OPEN_STANDARD's zero rules is a correct, complete value (an open
    // cabinet genuinely has no hardware) — but the intake validator's generic completeness heuristic cannot
    // distinguish that from "not yet filled in" and flags any empty `rules` as UNVERIFIED, which a
    // PRODUCTION_CANDIDATE may never carry. WORKING_DRAFT still submits and approves normally: nothing in the
    // database's own approval preconditions requires a hardware rule set to have at least one rule.
    intake("hardware_rule_set", OPEN_STANDARD.ruleSetId, OPEN_STANDARD, "PROCUREMENT", "PRODUCTION", { intent: "WORKING_DRAFT" }),
    intake("hardware_rule_set", PULLOUT_STANDARD.ruleSetId, PULLOUT_STANDARD, "PROCUREMENT", "PRODUCTION"),
    // WORKING_DRAFT, not PRODUCTION_CANDIDATE: same reasoning as OPEN_STANDARD above — zero rules is a correct,
    // complete value this slice (no front to hinge, no hardware defined for the appliance bay itself).
    intake("hardware_rule_set", OVEN_TOWER_STANDARD.ruleSetId, OVEN_TOWER_STANDARD, "PROCUREMENT", "PRODUCTION", { intent: "WORKING_DRAFT" }),
    intake("hardware_rule_set", SINK_STANDARD.ruleSetId, SINK_STANDARD, "PROCUREMENT", "PRODUCTION"),
    intake("construction_recipe", KITCHEN_BASE_STANDARD_V1.recipeId, KITCHEN_BASE_STANDARD_V1, "DESIGN_HEAD", "PRODUCTION"),
    intake("construction_recipe", KITCHEN_BASE_DRAWER_V1.recipeId, KITCHEN_BASE_DRAWER_V1, "DESIGN_HEAD", "PRODUCTION"),
    intake("construction_recipe", KITCHEN_BASE_OPEN_V1.recipeId, KITCHEN_BASE_OPEN_V1, "DESIGN_HEAD", "PRODUCTION"),
    intake("construction_recipe", KITCHEN_BASE_PULLOUT_V1.recipeId, KITCHEN_BASE_PULLOUT_V1, "DESIGN_HEAD", "PRODUCTION"),
    intake("construction_recipe", KITCHEN_TALL_OVEN_V1.recipeId, KITCHEN_TALL_OVEN_V1, "DESIGN_HEAD", "PRODUCTION"),
    intake("construction_recipe", KITCHEN_BASE_SINK_V1.recipeId, KITCHEN_BASE_SINK_V1, "DESIGN_HEAD", "PRODUCTION"),
    intake("product", product.productId, product, "DESIGN_HEAD", "PRODUCTION", { recipe: { entityCode: KITCHEN_BASE_STANDARD_V1.recipeId, versionNumber: 1 } }),
    intake("product", productDrawer.productId, productDrawer, "DESIGN_HEAD", "PRODUCTION", { recipe: { entityCode: KITCHEN_BASE_DRAWER_V1.recipeId, versionNumber: 1 } }),
    intake("product", productOpen.productId, productOpen, "DESIGN_HEAD", "PRODUCTION", { recipe: { entityCode: KITCHEN_BASE_OPEN_V1.recipeId, versionNumber: 1 } }),
    intake("product", productPullout.productId, productPullout, "DESIGN_HEAD", "PRODUCTION", { recipe: { entityCode: KITCHEN_BASE_PULLOUT_V1.recipeId, versionNumber: 1 } }),
    intake("product", productOven.productId, productOven, "DESIGN_HEAD", "PRODUCTION", { recipe: { entityCode: KITCHEN_TALL_OVEN_V1.recipeId, versionNumber: 1 } }),
    intake("product", productSink.productId, productSink, "DESIGN_HEAD", "PRODUCTION", { recipe: { entityCode: KITCHEN_BASE_SINK_V1.recipeId, versionNumber: 1 } }),
    intake("material_catalog", "REHEARSAL_MATERIAL_CATALOG", catalog("rehearsal materials", [...MATERIALS.map((m) => ["material", m.materialId] as const), ...EDGE_BANDS.map((b) => ["edge_band", b.edgeBandId] as const)]), "PROCUREMENT", "DESIGN_HEAD"),
    intake("finish_catalog", "REHEARSAL_FINISH_CATALOG", catalog("rehearsal finishes", FINISHES.map((f) => ["finish", f.finishId] as const)), "PROCUREMENT", "DESIGN_HEAD"),
    intake("appliance_catalog", "REHEARSAL_APPLIANCE_CATALOG", catalog("rehearsal appliances", APPLIANCES.map((a) => ["appliance", a.applianceId] as const)), "PROCUREMENT", "DESIGN_HEAD"),
    intake("hardware_catalog", "REHEARSAL_HARDWARE_CATALOG", catalog("rehearsal hardware", [["hardware_rule_set", HINGE_STANDARD.ruleSetId], ["hardware_rule_set", DRAWER_STANDARD.ruleSetId], ["hardware_rule_set", OPEN_STANDARD.ruleSetId], ["hardware_rule_set", PULLOUT_STANDARD.ruleSetId], ["hardware_rule_set", OVEN_TOWER_STANDARD.ruleSetId], ["hardware_rule_set", SINK_STANDARD.ruleSetId]]), "PROCUREMENT", "PRODUCTION"),
    intake("product_catalog", "REHEARSAL_PRODUCT_CATALOG", catalog("rehearsal products", [["product", product.productId], ["product", productDrawer.productId], ["product", productOpen.productId], ["product", productPullout.productId], ["product", productOven.productId], ["product", productSink.productId]]), "DESIGN_HEAD", "PRODUCTION"),
    intake("hettich_dataset", "REHEARSAL_HETTICH", rehearsalHettichDataset(), "PROCUREMENT", "PRODUCTION"),
    intake("pricing_standard", "REHEARSAL_PRICING_STANDARD", {
      rateCard: { ...rate, rateCardId: "REHEARSAL_RATE_CARD", status: "DRAFT", classification: "PRODUCTION", source: REHEARSAL_SOURCE, hardwarePerUnit },
      rules: { ...TEST_FIXTURE_PRICING_RULES, ruleSetId: "REHEARSAL_PRICING_RULES", status: "DRAFT", classification: "PRODUCTION", source: REHEARSAL_SOURCE },
    }, "COSTING", "FINANCE"),
    intake("quotation_policy", "REHEARSAL_QUOTATION_POLICY", {
      ...q, policyId: "REHEARSAL_QUOTATION_POLICY", status: "DRAFT", classification: "PRODUCTION", source: REHEARSAL_SOURCE,
      taxRates: { REHEARSAL_RATE_18: 18 }, taxRateByProductCategory: { KITCHEN_BASE: "REHEARSAL_RATE_18" },
    }, "COSTING", "FINANCE"),
  ];
}
