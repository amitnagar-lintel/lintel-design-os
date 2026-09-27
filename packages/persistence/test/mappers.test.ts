import { describe, expect, it } from "vitest";
import type { ConstructionStandard, DesignObject, EdgeBandStandard } from "@lintel/types";
import {
  LINTEL_CATALOG,
  LINTEL_CONSTRUCTION_STANDARD_DRAFT,
  LINTEL_EDGE_BAND_STANDARD_DRAFT,
  LINTEL_PLANNING_STANDARD_DRAFT,
  TEST_FIXTURE_CONSTRUCTION_STANDARD,
  TEST_FIXTURE_EDGE_BAND_STANDARD,
  TEST_FIXTURE_PLANNING_STANDARD,
} from "@lintel/catalog-engine";
import { HETTICH_PRODUCTION_DATASET, HETTICH_TEST_FIXTURE_DATASET } from "@lintel/hettich-engine";
import type { HettichProductionDataset } from "@lintel/hettich-engine";
import type { VersionMeta } from "../src/index.js";
import {
  constructionStandardFromRows,
  constructionStandardToRows,
  contentHash,
  designVersionContentHash,
  designObjectFromRow,
  designObjectToRow,
  edgeBandFromRow,
  edgeBandStandardFromRows,
  edgeBandStandardToRows,
  edgeBandToRow,
  finishFromRow,
  finishToRow,
  hardwareRuleSetFromRows,
  hardwareRuleSetToRows,
  hettichDatasetFromRows,
  hettichDatasetToRows,
  inrToPaise,
  MappingError,
  materialFromRow,
  materialToRow,
  planningStandardFromRows,
  planningStandardToRows,
  pricingStandardFromRows,
  pricingStandardToRows,
  productFromRow,
  productToRow,
  quotationPolicyFromRows,
  quotationPolicyToRows,
  recipeFromRow,
  recipeToRow,
  lifecycleStatusFromDesignState,
  roomFromRows,
  roomToRows,
  TestFixturePersistenceError,
} from "../src/index.js";

const CTX = { orgId: "org_lintel" };
const T0 = "2026-09-26T10:00:00.000Z";
const meta = (over: Partial<VersionMeta> = {}): VersionMeta => ({
  entityId: "ent_1",
  versionId: "ver_1",
  versionNumber: 1,
  status: "DRAFT",
  sourceRef: null,
  changeReason: "Initial version",
  createdBy: "user_author",
  createdAt: T0,
  submittedBy: null,
  submittedAt: null,
  approvedBy: null,
  approvedAt: null,
  effectiveFrom: null,
  lockedBy: null,
  lockedAt: null,
  supersededBy: null,
  supersededAt: null,
  ...over,
});

describe("standards map to rows and back without loss (production drafts)", () => {
  it("ConstructionStandard: every NULL value stays NULL", () => {
    const rows = constructionStandardToRows(LINTEL_CONSTRUCTION_STANDARD_DRAFT, meta(), CTX);
    expect(rows.values).toHaveLength(15);
    expect(rows.values.every((v) => v.value === null)).toBe(true);
    expect(rows.version).toMatchObject({ entity_code: "LINTEL_CONSTRUCTION_STANDARD", version_label: "0.2.0", status: "DRAFT", data_classification: "PRODUCTION", org_id: "org_lintel" });
    expect(constructionStandardFromRows(rows).value).toEqual(LINTEL_CONSTRUCTION_STANDARD_DRAFT);
  });
  it("PlanningStandard", () => {
    expect(planningStandardFromRows(planningStandardToRows(LINTEL_PLANNING_STANDARD_DRAFT, meta(), CTX)).value).toEqual(LINTEL_PLANNING_STANDARD_DRAFT);
  });
  it("EdgeBandStandard keeps an existing but empty rule set (rules not yet defined)", () => {
    const rows = edgeBandStandardToRows(LINTEL_EDGE_BAND_STANDARD_DRAFT, meta(), CTX);
    expect(rows.ruleSets.map((s) => s.rule_set_code)).toEqual(["CARCASS_STANDARD", "DRAWER_CARCASS_STANDARD"]);
    expect(rows.rules).toEqual([]);
    expect(edgeBandStandardFromRows(rows).value).toEqual(LINTEL_EDGE_BAND_STANDARD_DRAFT);
  });
  it("mapper mechanics with numbers and explicit 'no banding' rules (synthetic sample, DRAFT, never stored)", () => {
    const sample: EdgeBandStandard = { ...LINTEL_EDGE_BAND_STANDARD_DRAFT, ruleSets: { CARCASS_STANDARD: { BACK: {}, SHELF: { FRONT: "EDGE_X" } } } };
    const rows = edgeBandStandardToRows(sample, meta(), CTX);
    expect(rows.rules.map((r) => [r.component_type, r.edge_side, r.edge_band_id])).toEqual([["BACK", null, null], ["SHELF", "FRONT", "EDGE_X"]]);
    expect(edgeBandStandardFromRows(rows).value).toEqual(sample);
    const numeric: ConstructionStandard = { ...LINTEL_CONSTRUCTION_STANDARD_DRAFT, variables: { ...LINTEL_CONSTRUCTION_STANDARD_DRAFT.variables, TOP_RAIL_WIDTH: 123.5 } };
    const nrows = constructionStandardToRows(numeric, meta(), CTX, { TOP_RAIL_WIDTH: { unit: "MM", source: "drawing D-1", evidenceRef: "doc-7", note: null } });
    expect(nrows.values.find((v) => v.variable_code === "TOP_RAIL_WIDTH")).toMatchObject({ value: 123.5, unit: "MM", source: "drawing D-1", evidence_ref: "doc-7" });
    expect(constructionStandardFromRows(nrows).value).toEqual(numeric);
  });
  it("per-value provenance is part of the content hash", () => {
    const a = constructionStandardToRows(LINTEL_CONSTRUCTION_STANDARD_DRAFT, meta(), CTX);
    const b = constructionStandardToRows(LINTEL_CONSTRUCTION_STANDARD_DRAFT, meta(), CTX, { TOP_RAIL_WIDTH: { unit: "MM", source: "x", evidenceRef: null, note: null } });
    expect(a.version.content_hash).not.toBe(b.version.content_hash);
    expect(constructionStandardToRows(LINTEL_CONSTRUCTION_STANDARD_DRAFT, meta({ status: "IN_REVIEW", submittedBy: "u", submittedAt: T0 }), CTX).version.content_hash).toBe(a.version.content_hash);
  });
});

describe("pricing and finance map without loss", () => {
  it("PricingStandard (rate card + rules), all rates NULL", async () => {
    const { LINTEL_PRODUCTION_RATE_CARD: rateCard, LINTEL_PRODUCTION_PRICING_RULES: rules } = await import("@lintel/pricing-engine");
    const rows = pricingStandardToRows("LINTEL_PRICING_STANDARD", { rateCard, rules }, meta(), CTX);
    expect(rows.rateLines.every((l) => l.rate_paise === null)).toBe(true);
    expect(pricingStandardFromRows(rows).value).toEqual({ rateCard, rules });
  });
  it("rates are stored as exact integer paise", () => {
    expect(inrToPaise(1234.56, "x")).toBe(123456);
    expect(() => inrToPaise(1.005, "x")).toThrow(MappingError);
  });
  it("QuotationPolicy", async () => {
    const { LINTEL_PRODUCTION_QUOTATION_POLICY: p } = await import("@lintel/pricing-engine");
    expect(quotationPolicyFromRows(quotationPolicyToRows(p, meta(), CTX)).value).toEqual(p);
  });
});

describe("catalog domains map without loss", () => {
  it("materials, edge bands, finishes", () => {
    for (const m of LINTEL_CATALOG.materials) expect(materialFromRow(materialToRow(m, meta(), CTX)).value).toEqual(m);
    for (const b of LINTEL_CATALOG.edgeBands) expect(edgeBandFromRow(edgeBandToRow(b, meta(), CTX)).value).toEqual(b);
    for (const f of LINTEL_CATALOG.finishes) expect(finishFromRow(finishToRow(f, meta(), CTX)).value).toEqual(f);
  });
  it("products, recipes (formulas stay data) and hardware rule sets", () => {
    for (const p of LINTEL_CATALOG.products) expect(productFromRow(productToRow(p, meta(), { ...CTX, recipeVersionId: "rcv_1" }, "Lintel catalog")).value).toEqual(p);
    for (const r of LINTEL_CATALOG.recipes) expect(recipeFromRow(recipeToRow(r, meta(), CTX, "Lintel catalog")).value).toEqual(r);
    for (const h of LINTEL_CATALOG.hardwareRuleSets) expect(hardwareRuleSetFromRows(hardwareRuleSetToRows(h, meta(), CTX, "Lintel catalog")).value).toEqual(h);
  });
  it("Hettich production dataset (empty until source-verified records exist)", () => {
    expect(hettichDatasetFromRows(hettichDatasetToRows(HETTICH_PRODUCTION_DATASET, meta(), CTX, "Hettich intake")).value).toEqual(HETTICH_PRODUCTION_DATASET);
  });
});

describe("status is authoritative and never laundered", () => {
  it("an engine object whose status disagrees with the record status is refused", () => {
    const approvedClaim = { ...LINTEL_CONSTRUCTION_STANDARD_DRAFT, status: "APPROVED" as const };
    expect(() => constructionStandardToRows(approvedClaim, meta(), CTX)).toThrow(MappingError);
  });
  it("persisted statuses map to engine statuses (APPROVED/LOCKED → APPROVED, SUPERSEDED → RETIRED)", () => {
    const rows = constructionStandardToRows(LINTEL_CONSTRUCTION_STANDARD_DRAFT, meta(), CTX);
    const as = (status: "LOCKED" | "SUPERSEDED" | "IN_REVIEW") => constructionStandardFromRows({ ...rows, version: { ...rows.version, status } }).value.status;
    expect(as("LOCKED")).toBe("APPROVED");
    expect(as("SUPERSEDED")).toBe("RETIRED");
    expect(as("IN_REVIEW")).toBe("DRAFT");
  });
  it("CHANGES_REQUIRED is never persisted as a status (D2)", () => {
    expect(() => lifecycleStatusFromDesignState("CHANGES_REQUIRED")).toThrow(MappingError);
    expect(lifecycleStatusFromDesignState("IN_REVIEW")).toBe("IN_REVIEW");
  });
});

describe("TEST_FIXTURE data can never become rows", () => {
  it("fixture standards are refused", () => {
    expect(() => constructionStandardToRows(TEST_FIXTURE_CONSTRUCTION_STANDARD, meta(), CTX)).toThrow(TestFixturePersistenceError);
    expect(() => planningStandardToRows(TEST_FIXTURE_PLANNING_STANDARD, meta(), CTX)).toThrow(TestFixturePersistenceError);
    expect(() => edgeBandStandardToRows(TEST_FIXTURE_EDGE_BAND_STANDARD, meta(), CTX)).toThrow(TestFixturePersistenceError);
  });
  it("fixture pricing, finance and Hettich data are refused", async () => {
    const pe = await import("@lintel/pricing-engine");
    expect(() => pricingStandardToRows("X", { rateCard: pe.TEST_FIXTURE_RATE_CARD, rules: pe.TEST_FIXTURE_PRICING_RULES }, meta(), CTX)).toThrow(TestFixturePersistenceError);
    expect(() => quotationPolicyToRows(pe.TEST_FIXTURE_QUOTATION_POLICY, meta(), CTX)).toThrow(TestFixturePersistenceError);
    expect(() => hettichDatasetToRows(HETTICH_TEST_FIXTURE_DATASET as unknown as HettichProductionDataset, meta(), CTX, "x")).toThrow(TestFixturePersistenceError);
  });
  it("a fixture-labelled catalog item is refused", () => {
    const m = LINTEL_CATALOG.materials[0];
    if (m === undefined) throw new Error("catalog has materials");
    expect(() => materialToRow({ ...m, status: "TEST_FIXTURE" }, meta(), CTX)).toThrow(TestFixturePersistenceError);
  });
});

describe("design data", () => {
  const object: DesignObject = {
    objectId: "obj_004",
    objectCode: "OBJ-KIT-004",
    projectId: "project_001",
    roomId: "room_001",
    objectType: "BASE_CABINET",
    productId: "KIT_BASE_STANDARD",
    transform: { x: 0, y: 0, z: 1200, rotationX: 0, rotationY: 90, rotationZ: 0 },
    dimensions: { width: 600, height: 720, depth: 560 },
    parameters: { frontType: "OVERLAY", shelfCount: 1 },
    status: "DRAFT",
  };
  it("objects round-trip; the engine objectId is the stable lineage id across versions", () => {
    const row = designObjectToRow(object, { ...CTX, designVersionId: "dv_2", rowId: "row_99", productVersionId: "prv_1" });
    expect(row).toMatchObject({ id: "row_99", lineage_id: "obj_004", rotation_y: 90 });
    expect(designObjectFromRow(row, { projectId: "project_001", roomId: "room_001" })).toEqual(object);
  });
  it("only quarter turns about the vertical axis can be persisted", () => {
    expect(() => designObjectToRow({ ...object, transform: { ...object.transform, rotationY: 45 } }, { ...CTX, designVersionId: "dv", rowId: "r", productVersionId: "prv_1" })).toThrow(MappingError);
    expect(() => designObjectToRow({ ...object, transform: { ...object.transform, rotationX: 90 } }, { ...CTX, designVersionId: "dv", rowId: "r", productVersionId: "prv_1" })).toThrow(MappingError);
  });
  it("rooms map to an identity row plus an insert-only survey revision", () => {
    const room = { id: "room_001", projectId: "project_001", name: "Kitchen", type: "KITCHEN" as const, length: 4200, width: 3200, height: 3000, wallThickness: 150 };
    const rows = roomToRows(room, { revisionId: "rr_1", revisionNumber: 1, source: "site survey 2026-09-20", surveyedBy: "user_site", surveyedAt: T0 }, CTX);
    expect(rows.revision.content_hash).toBe(contentHash({ length: 4200, width: 3200, height: 3000, wallThickness: 150 }));
    expect(roomFromRows(rows.room, rows.revision)).toEqual(room);
  });
});

describe("designVersionContentHash", () => {
  const base = {
    inputHash: contentHash("inputs"),
    roomRevisionId: "rr_1",
    basedOnVersionId: null,
    versionLabel: "v1",
    changeReason: "first",
    source: "designer",
    authoredEngineVersion: "0.1.0",
  };
  it("is deterministic and changes with any input or draft metadata", () => {
    expect(designVersionContentHash(base)).toBe(designVersionContentHash({ ...base }));
    for (const change of [{ inputHash: contentHash("other") }, { roomRevisionId: "rr_2" }, { basedOnVersionId: "dv_0" }, { versionLabel: null }, { changeReason: "second" }, { source: "x" }, { authoredEngineVersion: "0.2.0" }]) {
      expect(designVersionContentHash({ ...base, ...change })).not.toBe(designVersionContentHash(base));
    }
  });
});
