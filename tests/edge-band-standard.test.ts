/**
 * M5 step 1: the EdgeBandStandard is a separate, versioned standard. Its version is part of
 * every trace, so a different edge standard makes derived results stale, while geometry,
 * BOM, BOQ, price and drawing geometry are driven only by their own inputs.
 */
import { describe, expect, it } from "vitest";
import type { DesignObject, EdgeBandStandard } from "@lintel/types";
import {
  LINTEL_CATALOG,
  LINTEL_CONSTRUCTION_STANDARD_DRAFT,
  LINTEL_EDGE_BAND_STANDARD_DRAFT,
  TEST_FIXTURE_CONSTRUCTION_STANDARD,
  TEST_FIXTURE_EDGE_BAND_STANDARD,
  TEST_FIXTURE_PLANNING_STANDARD,
} from "@lintel/catalog-engine";
import { createHettichAdapter, HETTICH_PRODUCTION_DATASET, HETTICH_TEST_FIXTURE_DATASET } from "@lintel/hettich-engine";
import { assertProductionEligible, compareRoomTrace, modelFingerprint, ProductionGuardError, resolveRoom } from "@lintel/design-engine";
import { checkDrawingStaleness } from "@lintel/drawing-engine";
import { isPriceStale } from "@lintel/pricing-engine";
import { DESIGN_VERSION, fixtureSlice, productionSlice, referenceObject, runSlice } from "./support/scenario.js";
import { created, elevation } from "./support/drawing.js";
import { price, priced } from "./support/pricing.js";
import { fixtureRoom, KITCHEN, lLayout, productionRoom } from "./support/room.js";

const fixtureAdapters = () => [createHettichAdapter(HETTICH_TEST_FIXTURE_DATASET)];
const withEdgeStandard = (edge: EdgeBandStandard, object: DesignObject = referenceObject()) =>
  runSlice(object, TEST_FIXTURE_CONSTRUCTION_STANDARD, edge, fixtureAdapters());
const roomWithEdgeStandard = (edge: EdgeBandStandard) =>
  resolveRoom({
    designVersion: DESIGN_VERSION,
    room: KITCHEN,
    objects: lLayout(),
    catalog: LINTEL_CATALOG,
    standard: TEST_FIXTURE_CONSTRUCTION_STANDARD,
    edgeBandStandard: edge,
    planning: TEST_FIXTURE_PLANNING_STANDARD,
    adapters: fixtureAdapters(),
  });

/** Same synthetic rules, next version: only the version reference differs. */
const NEXT_VERSION: EdgeBandStandard = { ...TEST_FIXTURE_EDGE_BAND_STANDARD, version: "0.0.2" };

/** Shelf front edge band changed from 0.8 mm to 2 mm; every other rule unchanged. */
const SHELF_CHANGED: EdgeBandStandard = {
  ...TEST_FIXTURE_EDGE_BAND_STANDARD,
  version: "0.0.2",
  ruleSets: { CARCASS_STANDARD: { ...TEST_FIXTURE_EDGE_BAND_STANDARD.ruleSets.CARCASS_STANDARD, SHELF: { FRONT: "EDGE_ABS_2MM" } } },
};

describe("trace carries the EdgeBandStandard version", () => {
  it("records construction, edge band, product, recipe, catalog and hardware dataset versions", () => {
    const { resolved, bom, boq } = fixtureSlice();
    expect(resolved.trace.standard).toEqual({ id: "TEST_FIXTURE_CONSTRUCTION_STANDARD", version: "0.0.4", status: "TEST_FIXTURE" });
    expect(resolved.trace.edgeBandStandard).toEqual({ id: "TEST_FIXTURE_EDGE_BAND_STANDARD", version: "0.0.1", status: "TEST_FIXTURE" });
    expect(resolved.trace.product.id).toBe("KIT_BASE_STANDARD");
    expect(resolved.trace.recipe.id).toBe("KITCHEN_BASE_STANDARD_V1");
    expect(resolved.trace.catalogVersion).toBe(LINTEL_CATALOG.catalogVersion);
    expect(resolved.trace.hardwareDatasets.map((d) => d.datasetId)).toEqual(["HETTICH_TEST_FIXTURE"]);
    expect(bom.trace.edgeBandStandard).toEqual(resolved.trace.edgeBandStandard);
    expect(boq.trace.edgeBandStandard).toEqual(resolved.trace.edgeBandStandard);
  });
});

describe("1. same inputs + same EdgeBandStandard version → identical result", () => {
  it("cabinet, BOM, BOQ, price and fingerprint are identical", () => {
    const a = fixtureSlice();
    const b = fixtureSlice();
    expect(b).toEqual(a);
    expect(modelFingerprint(b.resolved)).toBe(modelFingerprint(a.resolved));
    expect(priced(price(b))).toEqual(priced(price(a)));
  });
  it("room result and fingerprint are identical", () => {
    const a = roomWithEdgeStandard(TEST_FIXTURE_EDGE_BAND_STANDARD);
    expect(roomWithEdgeStandard(TEST_FIXTURE_EDGE_BAND_STANDARD)).toEqual(a);
    expect(compareRoomTrace(a.trace, a.roomFingerprint, roomWithEdgeStandard(TEST_FIXTURE_EDGE_BAND_STANDARD)).stale).toBe(false);
  });
});

describe("2. same inputs + different EdgeBandStandard version → stale", () => {
  it("price snapshot and drawing become stale", () => {
    const before = fixtureSlice();
    const after = withEdgeStandard(NEXT_VERSION);
    expect(modelFingerprint(after.resolved)).not.toBe(modelFingerprint(before.resolved));
    expect(isPriceStale(priced(price(before)), after.resolved)).toBe(true);
    const drawing = created(elevation(before.resolved));
    expect(checkDrawingStaleness(drawing, before.resolved).stale).toBe(false);
    expect(checkDrawingStaleness(drawing, after.resolved).stale).toBe(true);
  });
  it("room-level artifacts (quotation, room drawings) report every cabinet as changed", () => {
    const before = roomWithEdgeStandard(TEST_FIXTURE_EDGE_BAND_STANDARD);
    const change = compareRoomTrace(before.trace, before.roomFingerprint, roomWithEdgeStandard(NEXT_VERSION));
    expect(change.stale).toBe(true);
    expect(change.changedObjectIds).toEqual(["obj_001", "obj_002", "obj_003", "obj_004"]);
  });
  it("the new version is distinguishable in the trace of every derived artifact", () => {
    const after = withEdgeStandard(NEXT_VERSION);
    expect(after.resolved.trace.edgeBandStandard.version).toBe("0.0.2");
    expect(after.bom.trace.edgeBandStandard.version).toBe("0.0.2");
    expect(after.boq.trace.edgeBandStandard.version).toBe("0.0.2");
    expect(priced(price(after)).trace.edgeBandStandard.version).toBe("0.0.2");
  });
});

describe("3. changing an edge rule does not change unrelated geometry", () => {
  it("panel dimensions, geometry, materials and all non-edge BOM items are unchanged; only shelf edges change", () => {
    const before = fixtureSlice();
    const after = withEdgeStandard(SHELF_CHANGED);
    const shape = (s: typeof before) => s.resolved.components.map((c) => ({ id: c.componentId, dimensions: c.dimensions, geometry: c.geometry, materialId: c.materialId, finishId: c.finishId }));
    expect(shape(after)).toEqual(shape(before));
    expect(after.resolved.derived).toEqual(before.resolved.derived);
    expect(after.resolved.hardwareRequirements).toEqual(before.resolved.hardwareRequirements);
    const edgesChanged = after.resolved.components.filter((c, i) => JSON.stringify(c.edges) !== JSON.stringify(before.resolved.components[i]?.edges)).map((c) => c.componentType);
    expect(edgesChanged.length).toBeGreaterThan(0);
    expect(new Set(edgesChanged)).toEqual(new Set(["SHELF"]));
    const nonEdge = (s: typeof before) => s.bom.items.filter((l) => l.kind !== "EDGE_BAND");
    expect(nonEdge(after)).toEqual(nonEdge(before));
  });
});

describe("4. production stays blocked by the DRAFT / NULL production EdgeBandStandard", () => {
  it("the production edge band standard is DRAFT with no rules defined", () => {
    expect(LINTEL_EDGE_BAND_STANDARD_DRAFT.status).toBe("DRAFT");
    expect(Object.values(LINTEL_EDGE_BAND_STANDARD_DRAFT.ruleSets).every((set) => Object.keys(set).length === 0)).toBe(true);
  });
  it("a production cabinet carries an EDGE_BAND_STANDARD_NOT_APPROVED blocker and cannot be approved", () => {
    const { resolved } = productionSlice();
    const m = resolved.validation.messages.find((x) => x.code === "EDGE_BAND_STANDARD_NOT_APPROVED");
    expect(m?.severity).toBe("BLOCKER");
    expect(m?.message).toContain("LINTEL_EDGE_BAND_STANDARD");
    expect(resolved.validation.canApprove).toBe(false);
    expect(resolved.validation.counts.BLOCKER).toBe(26);
    expect(() => {
      assertProductionEligible({ ...DESIGN_VERSION, status: "APPROVED" }, resolved.validation);
    }).toThrow(ProductionGuardError);
  });
  it("the production room is blocked, with the edge band blocker on every cabinet", () => {
    const room = productionRoom();
    expect(room.validation.canApprove).toBe(false);
    expect(room.validation.counts.BLOCKER).toBe(108);
    expect(room.validation.messages.filter((x) => x.code === "EDGE_BAND_STANDARD_NOT_APPROVED")).toHaveLength(4);
  });
  it("an approved construction standard alone would not unblock edge banding", () => {
    const { resolved } = runSlice(referenceObject(), { ...LINTEL_CONSTRUCTION_STANDARD_DRAFT, status: "APPROVED" }, LINTEL_EDGE_BAND_STANDARD_DRAFT, [createHettichAdapter(HETTICH_PRODUCTION_DATASET)]);
    expect(resolved.validation.messages.map((x) => x.code)).toContain("EDGE_BAND_STANDARD_NOT_APPROVED");
    expect(resolved.validation.canApprove).toBe(false);
  });
});

describe("5. TEST_FIXTURE edge rules are classified and never enter production", () => {
  it("the fixture edge band standard is labelled TEST_FIXTURE and is distinct from production", () => {
    expect(TEST_FIXTURE_EDGE_BAND_STANDARD.status).toBe("TEST_FIXTURE");
    expect(TEST_FIXTURE_EDGE_BAND_STANDARD.standardId).not.toBe(LINTEL_EDGE_BAND_STANDARD_DRAFT.standardId);
    expect(LINTEL_EDGE_BAND_STANDARD_DRAFT.ruleSets).not.toEqual(TEST_FIXTURE_EDGE_BAND_STANDARD.ruleSets);
  });
  it("using it makes the result TEST_FIXTURE with explicit blockers, even with production construction data", () => {
    const r = runSlice(referenceObject(), LINTEL_CONSTRUCTION_STANDARD_DRAFT, TEST_FIXTURE_EDGE_BAND_STANDARD, [createHettichAdapter(HETTICH_PRODUCTION_DATASET)]);
    expect(r.resolved.trace.dataClassification).toBe("TEST_FIXTURE");
    expect(r.resolved.trace.testFixtureSources).toContain("edge band standard TEST_FIXTURE_EDGE_BAND_STANDARD");
    const codes = r.resolved.validation.messages.filter((m) => m.severity === "BLOCKER").map((m) => m.code);
    expect(codes).toEqual(expect.arrayContaining(["TEST_FIXTURE_DATA_IN_USE", "EDGE_BAND_STANDARD_NOT_APPROVED"]));
  });
  it("production pricing refuses a cabinet resolved with fixture edge rules", () => {
    const r = runSlice(referenceObject(), LINTEL_CONSTRUCTION_STANDARD_DRAFT, TEST_FIXTURE_EDGE_BAND_STANDARD, [createHettichAdapter(HETTICH_PRODUCTION_DATASET)]);
    expect(price(r, { mode: "PRODUCTION" }).status).toBe("UNAVAILABLE");
  });
  it("the fixture room lists the fixture edge band standard among its fixture sources", () => {
    expect(fixtureRoom().trace.testFixtureSources).toContain("edge band standard TEST_FIXTURE_EDGE_BAND_STANDARD");
  });
});
