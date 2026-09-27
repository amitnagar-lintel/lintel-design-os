/**
 * Production intake validation. The "complete" record below is a TEST-ONLY shape
 * with deliberately fake values (not Hettich data) that proves the mechanism:
 * only fully sourced, verified, licence-cleared records are ever used.
 */
import { describe, expect, it } from "vitest";
import type { HardwareRequirement } from "@lintel/types";
import type { HettichCalculationRule, HettichProductionDataset, HettichProductionRecord } from "../src/index.js";
import { createHettichAdapter, HETTICH_TEST_FIXTURE_DATASET, isOfficialHettichUrl, usableData, validateFixtureDataset, validateProductionRecord, validateProductionRule } from "../src/index.js";

const SRC = { url: "https://www.hettich.com/example-test-only", sourceDate: "2026-01-01", documentTitle: "TEST ONLY", documentVersion: "test" };

const complete: HettichProductionRecord = {
  recordId: "TEST-REC-1",
  articleNumber: "TEST-ONLY-NOT-A-REAL-ARTICLE",
  productFamily: "TEST_FAMILY",
  series: null,
  category: "HINGE",
  description: "Test-only record shape",
  exactApplication: { description: "test", application: "HINGED_DOOR", mounting: "FULL_OVERLAY" },
  dimensions: { testDimension: { value: 1, unit: "MM" } },
  compatibility: { doorThicknessRange: { min: 15, max: 24 }, openingAngle: 110, nominalLength: null, compatibleArticles: [], notes: null },
  drilling: { patternId: "TEST-PATTERN", holes: [{ face: "test", datum: "test", x: 1, y: 1, diameter: 1, depth: 1 }], source: SRC },
  installation: { guide: SRC, notes: null },
  adjustment: { ranges: { test: { min: 0, max: 1, unit: "MM" } }, notes: null },
  accessories: [],
  cadReference: { assetId: "TEST-CAD", formats: ["DXF"], url: "https://www.hettich.com/example-test-only-cad" },
  source: SRC,
  licence: { status: "OFFICIAL_PUBLIC", usageNotes: "test" },
  verification: { verifiedBy: "test", verifiedAt: "2026-01-01" },
  preferenceRank: 1,
};
const rule: HettichCalculationRule = {
  ruleId: "TEST-RULE",
  family: "TEST_FAMILY",
  category: "HINGE",
  description: "test",
  bands: [{ when: "DOOR_HEIGHT <= 900", quantity: "2" }],
  source: SRC,
  verification: { verifiedBy: "test", verifiedAt: "2026-01-01" },
  sourceVersion: "test",
};
const dataset = (records: HettichProductionRecord[], rules: HettichCalculationRule[] = [rule]): HettichProductionDataset => ({
  kind: "PRODUCTION",
  datasetId: "TEST_PRODUCTION_SHAPE",
  sourceVersion: "test",
  notes: "test",
  records,
  calculationRules: rules,
});
const requirement: HardwareRequirement = {
  requirementId: "R-HINGE",
  sourceObjectId: "o",
  sourceComponentId: "C",
  hardwareRuleId: "HINGE_SHUTTER",
  category: "HINGE",
  preferredManufacturer: "HETTICH",
  fittingSituation: {
    application: "HINGED_DOOR",
    cabinetType: "BASE_CABINET",
    componentType: "SHUTTER",
    mounting: "FULL_OVERLAY",
    doorWidth: 297,
    doorHeight: 717,
    doorThickness: 18,
    doorMaterialId: "X",
    doorWeightKg: null,
    openingAngleRequired: null,
    availableDepth: 560,
  },
};

describe("validateProductionRecord", () => {
  it("accepts a fully sourced, verified, licence-cleared record", () => {
    expect(validateProductionRecord(complete)).toEqual([]);
  });
  it("reports every NULL / UNVERIFIED field individually", () => {
    const blank: HettichProductionRecord = {
      ...complete,
      articleNumber: null,
      productFamily: null,
      dimensions: null,
      drilling: { patternId: null, holes: null, source: null },
      cadReference: null,
      accessories: null,
      verification: { verifiedBy: null, verifiedAt: null },
    };
    const paths = validateProductionRecord(blank).map((m) => m.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "hettich.records.TEST-REC-1.articleNumber",
        "hettich.records.TEST-REC-1.productFamily",
        "hettich.records.TEST-REC-1.dimensions",
        "hettich.records.TEST-REC-1.drilling.patternId",
        "hettich.records.TEST-REC-1.drilling.holes",
        "hettich.records.TEST-REC-1.drilling.source",
        "hettich.records.TEST-REC-1.cadReference",
        "hettich.records.TEST-REC-1.accessories",
        "hettich.records.TEST-REC-1.verification.verifiedBy",
      ]),
    );
    expect(validateProductionRecord(blank).every((m) => m.severity === "BLOCKER")).toBe(true);
  });
  it("rejects fixture articles, unofficial sources and uncleared licences", () => {
    const codes = (r: HettichProductionRecord) => validateProductionRecord(r).map((m) => m.code);
    expect(codes({ ...complete, articleNumber: "FIXTURE-HINGE-FO-A" })).toContain("HETTICH_FIXTURE_IN_PRODUCTION");
    expect(codes({ ...complete, source: { ...SRC, url: "https://example.com/hinge" } })).toContain("HETTICH_SOURCE_NOT_OFFICIAL");
    expect(codes({ ...complete, source: { ...SRC, sourceDate: "last year" } })).toContain("HETTICH_FIELD_UNVERIFIED");
    expect(codes({ ...complete, licence: { status: "UNKNOWN", usageNotes: null } })).toContain("HETTICH_LICENCE_NOT_CLEARED");
  });
  it("only accepts https URLs on hettich.com", () => {
    expect(isOfficialHettichUrl("https://www.hettich.com/x")).toBe(true);
    expect(isOfficialHettichUrl("https://hettich.com/x")).toBe(true);
    expect(isOfficialHettichUrl("http://www.hettich.com/x")).toBe(false);
    expect(isOfficialHettichUrl("https://hettich.com.example.org/x")).toBe(false);
    expect(isOfficialHettichUrl("https://nothettich.com/x")).toBe(false);
    expect(isOfficialHettichUrl(null)).toBe(false);
  });
  it("requires sourced, verified calculation rules", () => {
    expect(validateProductionRule(rule)).toEqual([]);
    expect(validateProductionRule({ ...rule, source: null, verification: null }).map((m) => m.code)).toEqual(["HETTICH_FIELD_UNVERIFIED", "HETTICH_FIELD_UNVERIFIED"]);
  });
});

describe("PRODUCTION dataset usage", () => {
  it("never uses an unverified record: it is excluded and the requirement stays UNRESOLVED", () => {
    const r = createHettichAdapter(dataset([{ ...complete, cadReference: null }])).resolve(requirement);
    expect(r.status).toBe("UNRESOLVED");
    expect(r.messages.map((m) => m.code)).toEqual(expect.arrayContaining(["HETTICH_FIELD_UNVERIFIED", "HARDWARE_DATA_UNAVAILABLE"]));
    expect(r.messages.find((m) => m.code === "HARDWARE_DATA_UNAVAILABLE")?.message).toMatch(/1 record\(s\) excluded/);
  });
  it("ignores unverified calculation rules (quantity unresolved rather than guessed)", () => {
    const r = createHettichAdapter(dataset([complete], [{ ...rule, verification: null }])).resolve(requirement);
    expect(r.status).toBe("UNRESOLVED");
    expect(r.messages.map((m) => m.code)).toContain("HARDWARE_QUANTITY_UNRESOLVED");
  });
  it("resolves from a verified record as PRODUCTION / authoritative, with source provenance", () => {
    const r = createHettichAdapter(dataset([complete])).resolve(requirement);
    expect(r.status).toBe("RESOLVED");
    expect(r.dataset).toEqual({ datasetId: "TEST_PRODUCTION_SHAPE", classification: "PRODUCTION", manufacturer: "HETTICH", sourceVersion: "test", authoritative: true });
    expect(r.lines).toEqual([
      { manufacturer: "HETTICH", articleNumber: "TEST-ONLY-NOT-A-REAL-ARTICLE", description: "Test-only record shape", category: "HINGE", quantity: 2, sourceUrl: SRC.url, sourceVersion: "test", licenseStatus: "OFFICIAL_PUBLIC" },
    ]);
    expect(r.messages).toEqual([]);
  });
});

describe("TEST_FIXTURE dataset separation", () => {
  it("the shipped fixture dataset is correctly labelled", () => {
    expect(validateFixtureDataset(HETTICH_TEST_FIXTURE_DATASET)).toEqual([]);
    expect(usableData(HETTICH_TEST_FIXTURE_DATASET).ref).toMatchObject({ classification: "TEST_FIXTURE", authoritative: false });
  });
  it("flags fixture articles that could be mistaken for real ones", () => {
    const bad = { ...HETTICH_TEST_FIXTURE_DATASET, articles: [{ ...HETTICH_TEST_FIXTURE_DATASET.articles[0]!, articleNumber: "123456" }] };
    expect(validateFixtureDataset(bad).map((m) => m.code)).toEqual(["HETTICH_FIXTURE_NOT_LABELLED"]);
  });
});
