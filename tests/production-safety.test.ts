/** Production safety rule: unverified / fixture data is always BLOCKED and never silently substituted. */
import { describe, expect, it } from "vitest";
import type { CatalogSnapshot } from "@lintel/types";
import {
  LINTEL_CATALOG,
  LINTEL_CONSTRUCTION_STANDARD_DRAFT,
  LINTEL_EDGE_BAND_STANDARD_DRAFT,
  TEST_FIXTURE_CONSTRUCTION_STANDARD,
  TEST_FIXTURE_EDGE_BAND_STANDARD,
} from "@lintel/catalog-engine";
import { createHettichAdapter, HETTICH_PRODUCTION_DATASET, HETTICH_TEST_FIXTURE_DATASET } from "@lintel/hettich-engine";
import { assertProductionEligible, resolveCabinet } from "@lintel/design-engine";
import { DESIGN_VERSION, fixtureSlice, productionSlice, referenceObject, runSlice } from "./support/scenario.js";

describe("trace data classification", () => {
  it("production configuration is classified PRODUCTION (and still blocked: data unapproved)", () => {
    const { resolved } = productionSlice();
    expect(resolved.trace.dataClassification).toBe("PRODUCTION");
    expect(resolved.trace.testFixtureSources).toEqual([]);
    expect(resolved.validation.canApprove).toBe(false);
  });
  it("any fixture input makes the whole result TEST_FIXTURE with an explicit BLOCKER", () => {
    const { resolved } = fixtureSlice();
    expect(resolved.trace.dataClassification).toBe("TEST_FIXTURE");
    expect(resolved.validation.messages.find((m) => m.code === "TEST_FIXTURE_DATA_IN_USE")?.severity).toBe("BLOCKER");
  });
  it("mixing one fixture source into production data is detected (standard)", () => {
    const r = runSlice(referenceObject(), TEST_FIXTURE_CONSTRUCTION_STANDARD, LINTEL_EDGE_BAND_STANDARD_DRAFT, [createHettichAdapter(HETTICH_PRODUCTION_DATASET)]);
    expect(r.resolved.trace.testFixtureSources).toEqual(["construction standard TEST_FIXTURE_CONSTRUCTION_STANDARD"]);
  });
  it("mixing one fixture source into production data is detected (edge band standard)", () => {
    const r = runSlice(referenceObject(), LINTEL_CONSTRUCTION_STANDARD_DRAFT, TEST_FIXTURE_EDGE_BAND_STANDARD, [createHettichAdapter(HETTICH_PRODUCTION_DATASET)]);
    expect(r.resolved.trace.dataClassification).toBe("TEST_FIXTURE");
    expect(r.resolved.trace.testFixtureSources).toEqual(["edge band standard TEST_FIXTURE_EDGE_BAND_STANDARD"]);
    expect(r.resolved.validation.messages.find((m) => m.code === "TEST_FIXTURE_DATA_IN_USE")?.severity).toBe("BLOCKER");
    expect(r.resolved.validation.canApprove).toBe(false);
  });
  it("mixing one fixture source into production data is detected (hardware)", () => {
    const r = runSlice(referenceObject(), LINTEL_CONSTRUCTION_STANDARD_DRAFT, LINTEL_EDGE_BAND_STANDARD_DRAFT, [createHettichAdapter(HETTICH_TEST_FIXTURE_DATASET)]);
    expect(r.resolved.trace.testFixtureSources).toEqual(["hardware dataset HETTICH_TEST_FIXTURE"]);
  });
  it("mixing one fixture source into production data is detected (material)", () => {
    const catalog: CatalogSnapshot = {
      ...LINTEL_CATALOG,
      materials: LINTEL_CATALOG.materials.map((m) => (m.materialId === "BOARD_BWP_18" ? { ...m, status: "TEST_FIXTURE" as const } : m)),
    };
    const r = resolveCabinet({ designVersion: DESIGN_VERSION, object: referenceObject(), catalog, standard: LINTEL_CONSTRUCTION_STANDARD_DRAFT, edgeBandStandard: LINTEL_EDGE_BAND_STANDARD_DRAFT, adapters: [createHettichAdapter(HETTICH_PRODUCTION_DATASET)] });
    expect(r.trace.testFixtureSources).toEqual(["material BOARD_BWP_18"]);
    expect(r.validation.messages.map((m) => m.code)).toContain("TEST_FIXTURE_DATA_IN_USE");
  });
});

describe("production output guard", () => {
  it("refuses production output for both configurations even if the design version were approved", () => {
    for (const slice of [productionSlice(), fixtureSlice()]) {
      expect(() => {
        assertProductionEligible({ ...DESIGN_VERSION, status: "APPROVED" }, slice.resolved.validation);
      }).toThrow(/BLOCKER/);
    }
  });
});
