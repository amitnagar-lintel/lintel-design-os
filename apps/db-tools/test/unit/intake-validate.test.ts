/**
 * Offline intake validation (M6 G2): strict schemas, TEST_FIXTURE isolation, identity, lifecycle, provenance,
 * completeness (UNVERIFIED) and determinism. The only numbers below are test inputs, never Lintel values.
 */
import {
  EDGE_BANDS, FINISHES, HINGE_STANDARD, KIT_BASE_STANDARD, KITCHEN_BASE_STANDARD_V1, LINTEL_CONSTRUCTION_STANDARD_DRAFT, LINTEL_EDGE_BAND_STANDARD_DRAFT, LINTEL_PLANNING_STANDARD_DRAFT, MATERIALS,
  TEST_FIXTURE_CONSTRUCTION_STANDARD,
} from "@lintel/catalog-engine";
import { HETTICH_PRODUCTION_DATASET, HETTICH_TEST_FIXTURE_DATASET } from "@lintel/hettich-engine";
import { LINTEL_PRODUCTION_PRICING_RULES, LINTEL_PRODUCTION_QUOTATION_POLICY, LINTEL_PRODUCTION_RATE_CARD, TEST_FIXTURE_PRICING_RULES, TEST_FIXTURE_RATE_CARD } from "@lintel/pricing-engine";
import { describe, expect, it } from "vitest";
import { stableUuid } from "../../src/intake/importer.js";
import {
  ConstructionRecipeSchema, ConstructionStandardSchema, EdgeBandSchema, EdgeBandStandardSchema, FinishSchema, HardwareRuleSetSchema, HettichProductionDatasetSchema, MaterialSchema,
  PlanningStandardSchema, PricingRuleSetSchema, ProductDefinitionSchema, QuotationPolicySchema, RateCardSchema, SCHEMAS_MATCH_DOMAIN_TYPES,
} from "../../src/intake/schemas.js";
import type { Finding } from "../../src/intake/spec.js";
import { validateIntake } from "../../src/intake/spec.js";
import { intakeFile, intakeObject } from "../support/intake-files.js";

const codes = (f: readonly Finding[], level?: Finding["level"]) => f.filter((x) => level === undefined || x.level === level).map((x) => x.code);
const construction = (over: Record<string, unknown> = {}, o: Parameters<typeof intakeFile>[3] = {}) =>
  validateIntake(intakeFile("construction_standard", LINTEL_CONSTRUCTION_STANDARD_DRAFT.standardId, { ...LINTEL_CONSTRUCTION_STANDARD_DRAFT, ...over }, o));

describe("schemas mirror the domain types", () => {
  it("every production object in the repository parses with its schema (the compile-time guard covers 13 types)", () => {
    expect(SCHEMAS_MATCH_DOMAIN_TYPES).toHaveLength(13);
    expect(ConstructionStandardSchema.parse(LINTEL_CONSTRUCTION_STANDARD_DRAFT)).toEqual(LINTEL_CONSTRUCTION_STANDARD_DRAFT);
    expect(PlanningStandardSchema.parse(LINTEL_PLANNING_STANDARD_DRAFT)).toEqual(LINTEL_PLANNING_STANDARD_DRAFT);
    expect(EdgeBandStandardSchema.parse(LINTEL_EDGE_BAND_STANDARD_DRAFT)).toEqual(LINTEL_EDGE_BAND_STANDARD_DRAFT);
    for (const m of MATERIALS) expect(MaterialSchema.parse(m)).toEqual(m);
    for (const b of EDGE_BANDS) expect(EdgeBandSchema.parse(b)).toEqual(b);
    for (const f of FINISHES) expect(FinishSchema.parse(f)).toEqual(f);
    expect(HardwareRuleSetSchema.parse(HINGE_STANDARD)).toEqual(HINGE_STANDARD);
    expect(ProductDefinitionSchema.parse(KIT_BASE_STANDARD)).toEqual(KIT_BASE_STANDARD);
    expect(ConstructionRecipeSchema.parse(KITCHEN_BASE_STANDARD_V1)).toEqual(KITCHEN_BASE_STANDARD_V1);
    expect(HettichProductionDatasetSchema.parse(HETTICH_PRODUCTION_DATASET)).toEqual(HETTICH_PRODUCTION_DATASET);
    expect(RateCardSchema.parse(LINTEL_PRODUCTION_RATE_CARD)).toEqual(LINTEL_PRODUCTION_RATE_CARD);
    expect(PricingRuleSetSchema.parse(LINTEL_PRODUCTION_PRICING_RULES)).toEqual(LINTEL_PRODUCTION_PRICING_RULES);
    expect(QuotationPolicySchema.parse(LINTEL_PRODUCTION_QUOTATION_POLICY)).toEqual(LINTEL_PRODUCTION_QUOTATION_POLICY);
  });
});

describe("the current production drafts", () => {
  it("are accepted as WORKING_DRAFT with every NULL listed as UNVERIFIED — and refused as PRODUCTION_CANDIDATE", () => {
    const draft = construction();
    expect(draft.accepted).toBe(true);
    expect(codes(draft.findings, "UNVERIFIED")).toEqual(Array(18).fill("VALUE_UNVERIFIED"));
    const candidate = construction({}, { intent: "PRODUCTION_CANDIDATE", sourceRef: { url: null, documentTitle: "Lintel standard", documentVersion: "1", sourceDate: "2026-09-26" } });
    expect(candidate.accepted).toBe(false);
    expect(codes(candidate.findings, "ERROR")).toEqual(["INCOMPLETE_PRODUCTION_DATA"]);

    const all: [Parameters<typeof intakeFile>[0], string, unknown, Parameters<typeof intakeFile>[3]?][] = [
      ["planning_standard", LINTEL_PLANNING_STANDARD_DRAFT.standardId, LINTEL_PLANNING_STANDARD_DRAFT],
      ["edge_band_standard", LINTEL_EDGE_BAND_STANDARD_DRAFT.standardId, LINTEL_EDGE_BAND_STANDARD_DRAFT],
      ...MATERIALS.map((m) => ["material", m.materialId, m] as [Parameters<typeof intakeFile>[0], string, unknown]),
      ...EDGE_BANDS.map((b) => ["edge_band", b.edgeBandId, b] as [Parameters<typeof intakeFile>[0], string, unknown]),
      ...FINISHES.map((f) => ["finish", f.finishId, f] as [Parameters<typeof intakeFile>[0], string, unknown]),
      ["hardware_rule_set", HINGE_STANDARD.ruleSetId, HINGE_STANDARD],
      ["construction_recipe", KITCHEN_BASE_STANDARD_V1.recipeId, KITCHEN_BASE_STANDARD_V1],
      ["product", KIT_BASE_STANDARD.productId, KIT_BASE_STANDARD, { recipe: { entityCode: KITCHEN_BASE_STANDARD_V1.recipeId, versionNumber: 1 } }],
      ["hettich_dataset", HETTICH_PRODUCTION_DATASET.datasetId, HETTICH_PRODUCTION_DATASET],
      ["pricing_standard", "LINTEL_PRICING_STANDARD", { rateCard: LINTEL_PRODUCTION_RATE_CARD, rules: LINTEL_PRODUCTION_PRICING_RULES }],
      ["quotation_policy", LINTEL_PRODUCTION_QUOTATION_POLICY.policyId, LINTEL_PRODUCTION_QUOTATION_POLICY],
    ];
    for (const [type, code, data, o] of all) {
      const r = validateIntake(intakeFile(type, code, data, o));
      expect([type, code, r.accepted, codes(r.findings, "ERROR")]).toEqual([type, code, true, []]);
    }
  });
});

describe("TEST_FIXTURE is never production", () => {
  it("refuses fixture objects, fixture classifications, fixture datasets and fixture codes", () => {
    expect(codes(validateIntake(intakeFile("construction_standard", TEST_FIXTURE_CONSTRUCTION_STANDARD.standardId, TEST_FIXTURE_CONSTRUCTION_STANDARD)).findings)).toContain("TEST_FIXTURE_REFUSED");
    expect(codes(construction({}, { classification: "TEST_FIXTURE" }).findings)).toContain("TEST_FIXTURE_REFUSED");
    expect(codes(construction({}, { classification: "SAMPLE" }).findings)).toContain("CLASSIFICATION_INVALID");
    const hettich = validateIntake(intakeFile("hettich_dataset", HETTICH_TEST_FIXTURE_DATASET.datasetId, HETTICH_TEST_FIXTURE_DATASET));
    expect([hettich.accepted, codes(hettich.findings)]).toEqual([false, expect.arrayContaining(["TEST_FIXTURE_REFUSED"])]);
    const pricing = validateIntake(intakeFile("pricing_standard", "LINTEL_PRICING_STANDARD", { rateCard: TEST_FIXTURE_RATE_CARD, rules: TEST_FIXTURE_PRICING_RULES }));
    expect([pricing.accepted, codes(pricing.findings)]).toEqual([false, expect.arrayContaining(["TEST_FIXTURE_REFUSED"])]);
    const code = validateIntake(intakeFile("construction_standard", "TEST_FIXTURE_X", { ...LINTEL_CONSTRUCTION_STANDARD_DRAFT, standardId: "TEST_FIXTURE_X" }));
    expect(codes(code.findings)).toContain("TEST_FIXTURE_REFUSED");
    const article = { ...HETTICH_PRODUCTION_DATASET, records: [] };
    expect(validateIntake(intakeFile("hettich_dataset", article.datasetId, article)).accepted).toBe(true);
  });
});

describe("lifecycle, identity and provenance", () => {
  it("imports only DRAFT data: an APPROVED or RETIRED object is refused (approval is the workflow's job)", () => {
    expect(codes(construction({ status: "APPROVED" }).findings, "ERROR")).toEqual(["STATUS_NOT_DRAFT"]);
    expect(codes(construction({ status: "RETIRED" }).findings, "ERROR")).toEqual(["STATUS_NOT_DRAFT"]);
    const rc = validateIntake(intakeFile("pricing_standard", "P", { rateCard: { ...LINTEL_PRODUCTION_RATE_CARD, effectiveFrom: "2026-10-01" }, rules: LINTEL_PRODUCTION_PRICING_RULES }));
    expect(codes(rc.findings, "ERROR")).toEqual(["EFFECTIVE_FROM_NOT_ALLOWED"]);
  });

  it("requires explicit, consistent identity and one source of record", () => {
    expect(codes(validateIntake(intakeFile("construction_standard", "OTHER_CODE", LINTEL_CONSTRUCTION_STANDARD_DRAFT)).findings, "ERROR")).toEqual(["IDENTITY_MISMATCH"]);
    expect(codes(construction({}, { source: "Somewhere else" }).findings, "ERROR")).toEqual(["SOURCE_MISMATCH"]);
    const product = validateIntake(intakeFile("product", KIT_BASE_STANDARD.productId, KIT_BASE_STANDARD));
    expect(codes(product.findings, "ERROR")).toEqual(["DEPENDENCY_MISSING"]);
    const wrongRecipe = validateIntake(intakeFile("product", KIT_BASE_STANDARD.productId, KIT_BASE_STANDARD, { recipe: { entityCode: "OTHER", versionNumber: 1 } }));
    expect(codes(wrongRecipe.findings, "ERROR")).toEqual(["IDENTITY_MISMATCH"]);
    const hw = validateIntake(JSON.stringify({ ...intakeObject("material", "X", MATERIALS[0]), type: "hardware_item" }));
    expect(codes(hw.findings, "ERROR")).toEqual(expect.arrayContaining(["TYPE_NOT_ACCEPTED", "FORMAT_INVALID"]));
    expect(codes(validateIntake(JSON.stringify({ ...intakeObject("material", "X", MATERIALS[0]), type: "appliance" })).findings, "ERROR")).toContain("TYPE_NOT_ACCEPTED");
  });

  it("never accepts an unsourced value; missing evidence is UNVERIFIED; provenance must name declared values", () => {
    const vars = { ...LINTEL_CONSTRUCTION_STANDARD_DRAFT.variables, BACK_GROOVE_DEPTH: 1 };
    expect(codes(construction({ variables: vars }).findings, "ERROR")).toEqual(["VALUE_WITHOUT_SOURCE"]);
    const sourced = construction({ variables: vars }, { provenance: { BACK_GROOVE_DEPTH: { unit: "MM", source: "Test drawing", evidenceRef: null, note: null } } });
    expect([sourced.accepted, codes(sourced.findings).filter((c) => c !== "VALUE_UNVERIFIED")]).toEqual([true, ["EVIDENCE_MISSING"]]);
    const stray = construction({}, { provenance: { NOT_A_VARIABLE: { unit: "MM", source: "x", evidenceRef: "y", note: null } } });
    expect(codes(stray.findings, "ERROR")).toEqual(["PROVENANCE_FOR_UNKNOWN_VALUE"]);
    const unknown = construction({ variables: { ...LINTEL_CONSTRUCTION_STANDARD_DRAFT.variables, INVENTED: null } });
    expect(codes(unknown.findings, "ERROR")).toEqual(["UNKNOWN_VARIABLE"]);
    const candidate = construction({}, { intent: "PRODUCTION_CANDIDATE" });
    expect(codes(candidate.findings, "ERROR")).toEqual(expect.arrayContaining(["PROVENANCE_MISSING", "PROVENANCE_MISSING", "INCOMPLETE_PRODUCTION_DATA"]));
  });
});

describe("invalid data and duplicates", () => {
  it("rejects malformed files and data with exact paths", () => {
    expect(codes(validateIntake("{ not json").findings)).toEqual(["FILE_NOT_JSON"]);
    expect(codes(validateIntake(JSON.stringify({ ...intakeObject("material", "X", MATERIALS[0]), extra: 1 })).findings)).toEqual(["FORMAT_INVALID"]);
    const r = validateIntake(intakeFile("material", MATERIALS[0]!.materialId, { ...MATERIALS[0], thickness: "18", colour: "white" }));
    expect(r.findings.filter((x) => x.code === "DATA_INVALID").map((x) => x.path).sort()).toEqual(["$.data.", "$.data.thickness"]);
    expect(codes(validateIntake(JSON.stringify({ ...intakeObject("material", "X", MATERIALS[0]), versionNumber: 0 })).findings)).toEqual(["FORMAT_INVALID"]);
  });

  it("detects duplicate records inside a dataset and duplicate catalog members", () => {
    const dupRules = { ...HINGE_STANDARD, rules: [...HINGE_STANDARD.rules, ...HINGE_STANDARD.rules] };
    expect(codes(validateIntake(intakeFile("hardware_rule_set", HINGE_STANDARD.ruleSetId, dupRules)).findings, "ERROR")).toContain("DUPLICATE_RECORD");
    const members = [{ itemType: "material", entityCode: "M", versionNumber: 1 }, { itemType: "material", entityCode: "M", versionNumber: 2 }, { itemType: "finish", entityCode: "F", versionNumber: 1 }];
    const cat = validateIntake(intakeFile("material_catalog", "LINTEL_MATERIAL_CATALOG", { versionLabel: "1", description: "x", members }, { source: "Lintel catalog" }));
    expect(codes(cat.findings, "ERROR").sort()).toEqual(["DUPLICATE_RECORD", "MEMBER_TYPE_INVALID"]);
    const dupPolicy = { ...LINTEL_PRODUCTION_QUOTATION_POLICY, taxRateByProductCategory: { KITCHEN_BASE: "NOT_DEFINED" } };
    expect(codes(validateIntake(intakeFile("quotation_policy", dupPolicy.policyId, dupPolicy)).findings, "ERROR")).toEqual(["REFERENCE_INVALID"]);
  });
});

describe("determinism", () => {
  it("the same bytes give the same report; ids are stable per organization, type, code and version", () => {
    const a = construction();
    const b = construction();
    expect(b).toEqual(a);
    const reordered = validateIntake(JSON.stringify(Object.fromEntries(Object.entries(intakeObject("construction_standard", LINTEL_CONSTRUCTION_STANDARD_DRAFT.standardId, LINTEL_CONSTRUCTION_STANDARD_DRAFT)).reverse())));
    expect(reordered.findings).toEqual(a.findings);
    expect(reordered.fileHash).not.toBe(a.fileHash);
    const id = stableUuid("org", "construction_standard", "CODE", "1");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stableUuid("org", "construction_standard", "CODE", "1")).toBe(id);
    expect(stableUuid("org", "construction_standard", "CODE", "2")).not.toBe(id);
  });
});
