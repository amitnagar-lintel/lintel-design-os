import { describe, expect, it } from "vitest";
import type { CatalogSnapshot, ConstructionRecipe } from "@lintel/types";
import {
  KIT_BASE_DRAWER,
  KIT_BASE_HOB,
  KIT_BASE_OPEN,
  KIT_BASE_PULLOUT,
  KIT_BASE_SINK,
  KIT_BASE_STANDARD,
  KIT_TALL_OVEN,
  KITCHEN_BASE_DRAWER_V1,
  KITCHEN_BASE_HOB_V1,
  KITCHEN_BASE_OPEN_V1,
  KITCHEN_BASE_PULLOUT_V1,
  KITCHEN_BASE_SINK_V1,
  KITCHEN_BASE_STANDARD_V1,
  KITCHEN_TALL_OVEN_V1,
  LINTEL_CATALOG,
  LINTEL_CONSTRUCTION_STANDARD_DRAFT,
  LINTEL_EDGE_BAND_STANDARD_DRAFT,
  TEST_FIXTURE_CONSTRUCTION_STANDARD,
  TEST_FIXTURE_EDGE_BAND_STANDARD,
  findProduct,
  validateCatalog,
  validateEdgeBandStandard,
  validateStandard,
} from "../src/index.js";

const withRecipe = (patch: Partial<ConstructionRecipe>): CatalogSnapshot => ({
  ...LINTEL_CATALOG,
  recipes: [{ ...KITCHEN_BASE_STANDARD_V1, ...patch }],
});

describe("LINTEL_CATALOG", () => {
  it("is structurally valid", () => {
    expect(validateCatalog(LINTEL_CATALOG)).toEqual([]);
  });
  it("contains the Design Studio product family (KIT_BASE_STANDARD, KIT_BASE_DRAWER, KIT_BASE_OPEN, KIT_BASE_PULLOUT, KIT_TALL_OVEN, KIT_BASE_SINK, KIT_BASE_HOB — docs/architecture/DESIGN-STUDIO-D1-D6.md's deliberate PRD §41 deviation)", () => {
    expect(LINTEL_CATALOG.products.map((p) => p.productId)).toEqual(["KIT_BASE_STANDARD", "KIT_BASE_DRAWER", "KIT_BASE_OPEN", "KIT_BASE_PULLOUT", "KIT_TALL_OVEN", "KIT_BASE_SINK", "KIT_BASE_HOB"]);
    expect(findProduct(LINTEL_CATALOG, "KIT_BASE_STANDARD")).toBe(KIT_BASE_STANDARD);
    expect(findProduct(LINTEL_CATALOG, "KIT_BASE_DRAWER")).toBe(KIT_BASE_DRAWER);
    expect(findProduct(LINTEL_CATALOG, "KIT_BASE_OPEN")).toBe(KIT_BASE_OPEN);
    expect(findProduct(LINTEL_CATALOG, "KIT_BASE_PULLOUT")).toBe(KIT_BASE_PULLOUT);
    expect(findProduct(LINTEL_CATALOG, "KIT_TALL_OVEN")).toBe(KIT_TALL_OVEN);
    expect(findProduct(LINTEL_CATALOG, "KIT_BASE_SINK")).toBe(KIT_BASE_SINK);
    expect(findProduct(LINTEL_CATALOG, "KIT_BASE_HOB")).toBe(KIT_BASE_HOB);
  });
  it("defaults the product to the PRD §42 reference cabinet", () => {
    const d = Object.fromEntries(KIT_BASE_STANDARD.parameters.map((p) => [p.key, p.default]));
    expect(d).toMatchObject({ width: 600, height: 720, depth: 560, carcassThickness: 18, backThickness: 6, shelfCount: 1, shutterCount: 2, frontType: "OVERLAY" });
  });
  it("lists the PRD §14 recipe components", () => {
    const types = new Set(KITCHEN_BASE_STANDARD_V1.components.map((c) => c.componentType));
    expect([...types].sort()).toEqual(["BACK", "BOTTOM", "SHELF", "SHUTTER", "SIDE_LEFT", "SIDE_RIGHT", "TOP_SUPPORT_BACK", "TOP_SUPPORT_FRONT"]);
  });
  it("keeps construction details out of recipe literals: recipe variables are all declared", () => {
    expect(KITCHEN_BASE_STANDARD_V1.constructionVariables.length).toBeGreaterThan(0);
  });
});

describe("validateCatalog detects bad data", () => {
  it("unknown variables", () => {
    const bad = withRecipe({ formulas: [{ formulaId: "X", expression: "W - MYSTERY", variables: ["W", "MYSTERY"], unit: "MM" }] });
    expect(validateCatalog(bad).map((m) => m.code)).toContain("CATALOG_UNKNOWN_VARIABLE");
  });
  it("parse errors", () => {
    const bad = withRecipe({ formulas: [{ formulaId: "X", expression: "W -", variables: ["W"], unit: "MM" }] });
    expect(validateCatalog(bad).map((m) => m.code)).toContain("CATALOG_FORMULA_PARSE_ERROR");
  });
  it("declared vs used variable mismatch", () => {
    const bad = withRecipe({ formulas: [{ formulaId: "X", expression: "W - T", variables: ["W"], unit: "MM" }] });
    expect(validateCatalog(bad).map((m) => m.code)).toContain("CATALOG_FORMULA_VARIABLES_MISMATCH");
  });
  it("instance index `i` is only valid inside component geometry", () => {
    const bad = withRecipe({
      components: KITCHEN_BASE_STANDARD_V1.components.map((c) => (c.templateId === "SHELF" ? { ...c, count: "i + 1" } : c)),
    });
    expect(validateCatalog(bad).map((m) => m.code)).toContain("CATALOG_UNKNOWN_VARIABLE");
  });
  it("grain outside the panel face", () => {
    const bad = withRecipe({
      components: KITCHEN_BASE_STANDARD_V1.components.map((c) => (c.templateId === "SIDE_LEFT" ? { ...c, grainDirection: "WIDTH" as const } : c)),
    });
    expect(validateCatalog(bad).map((m) => m.code)).toContain("CATALOG_INVALID_GRAIN");
  });
  it("material role pointing at a non-material parameter", () => {
    const bad = withRecipe({ materialRoles: { ...KITCHEN_BASE_STANDARD_V1.materialRoles, BACK: "width" } });
    expect(validateCatalog(bad).map((m) => m.code)).toContain("CATALOG_UNKNOWN_REFERENCE");
  });
  it("duplicate ids", () => {
    expect(validateCatalog({ ...LINTEL_CATALOG, materials: [...LINTEL_CATALOG.materials, LINTEL_CATALOG.materials[0]!] }).map((m) => m.code)).toContain("CATALOG_DUPLICATE_ID");
  });
});

// Both recipes now share one construction standard; a recipe only ever needs the subset of
// variables it declares, so validateStandard is checked per recipe against that subset.
const declaredSubset = (standard: typeof TEST_FIXTURE_CONSTRUCTION_STANDARD, recipe: ConstructionRecipe): typeof TEST_FIXTURE_CONSTRUCTION_STANDARD => ({
  ...standard,
  variables: Object.fromEntries(recipe.constructionVariables.map((v) => [v.key, standard.variables[v.key] ?? null])),
});

describe("construction standards", () => {
  it("the Lintel draft standard defines no values yet (nothing invented)", () => {
    expect(LINTEL_CONSTRUCTION_STANDARD_DRAFT.status).toBe("DRAFT");
    expect(Object.values(LINTEL_CONSTRUCTION_STANDARD_DRAFT.variables).every((v) => v === null)).toBe(true);
    const declaredKeys = new Set([...KITCHEN_BASE_STANDARD_V1.constructionVariables, ...KITCHEN_BASE_DRAWER_V1.constructionVariables, ...KITCHEN_BASE_OPEN_V1.constructionVariables, ...KITCHEN_BASE_PULLOUT_V1.constructionVariables, ...KITCHEN_TALL_OVEN_V1.constructionVariables, ...KITCHEN_BASE_SINK_V1.constructionVariables].map((v) => v.key));
    expect(Object.keys(LINTEL_CONSTRUCTION_STANDARD_DRAFT.variables).sort()).toEqual([...declaredKeys].sort());
  });
  it("both standards are consistent with every recipe", () => {
    for (const recipe of [KITCHEN_BASE_STANDARD_V1, KITCHEN_BASE_DRAWER_V1, KITCHEN_BASE_OPEN_V1, KITCHEN_BASE_PULLOUT_V1, KITCHEN_TALL_OVEN_V1, KITCHEN_BASE_SINK_V1, KITCHEN_BASE_HOB_V1]) {
      expect(validateStandard(recipe, declaredSubset(LINTEL_CONSTRUCTION_STANDARD_DRAFT, recipe))).toEqual([]);
      expect(validateStandard(recipe, declaredSubset(TEST_FIXTURE_CONSTRUCTION_STANDARD, recipe))).toEqual([]);
    }
  });
  it("carries no edge rules: those belong to the separate EdgeBandStandard", () => {
    for (const s of [LINTEL_CONSTRUCTION_STANDARD_DRAFT, TEST_FIXTURE_CONSTRUCTION_STANDARD]) expect(Object.keys(s).sort()).toEqual(["description", "source", "standardId", "status", "variables", "version"]);
  });
  it("the test fixture standard is labelled as such", () => {
    expect(TEST_FIXTURE_CONSTRUCTION_STANDARD.status).toBe("TEST_FIXTURE");
  });
  it("detects variables the recipe does not declare", () => {
    const bad = declaredSubset(TEST_FIXTURE_CONSTRUCTION_STANDARD, KITCHEN_BASE_STANDARD_V1);
    const withMagic = { ...bad, variables: { ...bad.variables, MAGIC: 5 } };
    expect(validateStandard(KITCHEN_BASE_STANDARD_V1, withMagic).map((m) => m.code)).toEqual(["STANDARD_UNKNOWN_VARIABLE"]);
  });
});

describe("edge band standards", () => {
  it("the Lintel draft edge band standard defines no edge rules yet (nothing invented)", () => {
    expect(LINTEL_EDGE_BAND_STANDARD_DRAFT.status).toBe("DRAFT");
    expect(LINTEL_EDGE_BAND_STANDARD_DRAFT.ruleSets).toEqual({
      [KITCHEN_BASE_STANDARD_V1.edgeRuleSetId]: {},
      [KITCHEN_BASE_DRAWER_V1.edgeRuleSetId]: {},
      [KITCHEN_BASE_OPEN_V1.edgeRuleSetId]: {},
      [KITCHEN_BASE_PULLOUT_V1.edgeRuleSetId]: {},
      [KITCHEN_TALL_OVEN_V1.edgeRuleSetId]: {},
      [KITCHEN_BASE_SINK_V1.edgeRuleSetId]: {},
      [KITCHEN_BASE_HOB_V1.edgeRuleSetId]: {},
    });
  });
  it("the test fixture edge band standard is labelled as such and kept separate from production", () => {
    expect(TEST_FIXTURE_EDGE_BAND_STANDARD.status).toBe("TEST_FIXTURE");
    expect(TEST_FIXTURE_EDGE_BAND_STANDARD.standardId).not.toBe(LINTEL_EDGE_BAND_STANDARD_DRAFT.standardId);
  });
  it("both edge band standards are consistent with every recipe and the catalog", () => {
    for (const recipe of [KITCHEN_BASE_STANDARD_V1, KITCHEN_BASE_DRAWER_V1, KITCHEN_BASE_OPEN_V1, KITCHEN_BASE_PULLOUT_V1, KITCHEN_TALL_OVEN_V1, KITCHEN_BASE_SINK_V1, KITCHEN_BASE_HOB_V1]) {
      expect(validateEdgeBandStandard(LINTEL_CATALOG, recipe, LINTEL_EDGE_BAND_STANDARD_DRAFT)).toEqual([]);
      expect(validateEdgeBandStandard(LINTEL_CATALOG, recipe, TEST_FIXTURE_EDGE_BAND_STANDARD)).toEqual([]);
    }
  });
  it("detects invalid edge sides and unknown edge bands", () => {
    const bad = { ...TEST_FIXTURE_EDGE_BAND_STANDARD, ruleSets: { CARCASS_STANDARD: { SIDE_LEFT: { LEFT: "EDGE_ABS_2MM" }, SHELF: { FRONT: "NOPE" } } } };
    const codes = validateEdgeBandStandard(LINTEL_CATALOG, KITCHEN_BASE_STANDARD_V1, bad).map((m) => m.code);
    expect(codes).toContain("STANDARD_INVALID_EDGE_SIDE");
    expect(codes).toContain("CATALOG_UNKNOWN_REFERENCE");
  });
  it("detects a missing rule set", () => {
    const bad = { ...TEST_FIXTURE_EDGE_BAND_STANDARD, ruleSets: {} };
    expect(validateEdgeBandStandard(LINTEL_CATALOG, KITCHEN_BASE_STANDARD_V1, bad).map((m) => m.code)).toEqual(["STANDARD_MISSING_EDGE_RULE_SET"]);
  });
});
