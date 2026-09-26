/**
 * PRD §43 modification tests A–E on KIT_BASE_STANDARD, using the TEST_FIXTURE
 * construction standard and TEST_FIXTURE Hettich data (mechanics only), plus the
 * production configuration, which must refuse to invent values.
 * Expected numbers are computed by hand from the recipe formulas.
 */
import { describe, expect, it } from "vitest";
import type { CatalogSnapshot } from "@lintel/types";
import { KIT_BASE_STANDARD, LINTEL_CATALOG, TEST_FIXTURE_CONSTRUCTION_STANDARD } from "@lintel/catalog-engine";
import { HETTICH_PRODUCTION_DATASET, HETTICH_TEST_FIXTURE_DATASET, createHettichAdapter } from "@lintel/hettich-engine";
import { modelFingerprint, resolveCabinet } from "@lintel/design-engine";
import { generateBom } from "@lintel/bom-engine";
import { generateBoq } from "@lintel/boq-engine";
import { DESIGN_VERSION, fixtureSlice, productionSlice, referenceObject, runSlice } from "./support/scenario.js";
import { bomItem, codes, comp, dims, pos } from "./support/helpers.js";

const hw = (r: ReturnType<typeof fixtureSlice>) =>
  r.bom.items.filter((i) => i.kind === "HARDWARE").map((i) => [i.articleNumber, i.quantity]);

describe("Test A — reference cabinet 600 × 720 × 560, two overlay shutters", () => {
  const { resolved, bom, boq } = fixtureSlice();

  it("generates the PRD §14 components with deterministic ids", () => {
    expect(resolved.components.map((c) => c.componentId)).toEqual([
      "OBJ-KIT-001-SL",
      "OBJ-KIT-001-SR",
      "OBJ-KIT-001-BOT",
      "OBJ-KIT-001-TSF",
      "OBJ-KIT-001-TSB",
      "OBJ-KIT-001-BCK",
      "OBJ-KIT-001-SHF-01",
      "OBJ-KIT-001-SHT-L",
      "OBJ-KIT-001-SHT-R",
    ]);
  });
  it("computes panel dimensions and positions from recipe formulas", () => {
    expect(dims(comp(resolved, "OBJ-KIT-001-SL"))).toEqual([560, 720, 18]);
    expect(pos(comp(resolved, "OBJ-KIT-001-SR"))).toEqual([582, 0, 0]);
    expect(dims(comp(resolved, "OBJ-KIT-001-BOT"))).toEqual([564, 560, 18]); // W - 2T
    expect(dims(comp(resolved, "OBJ-KIT-001-TSF"))).toEqual([564, 100, 18]);
    expect(pos(comp(resolved, "OBJ-KIT-001-TSF"))).toEqual([18, 702, 460]);
    expect(pos(comp(resolved, "OBJ-KIT-001-TSB"))).toEqual([18, 702, 22]);
    expect(dims(comp(resolved, "OBJ-KIT-001-BCK"))).toEqual([580, 710, 6]); // 564 + 2·8, 720 − 18 + 8
    expect(dims(comp(resolved, "OBJ-KIT-001-SHF-01"))).toEqual([562, 518, 18]); // 564 − 2, 560 − 16 − 6 − 20
    expect(pos(comp(resolved, "OBJ-KIT-001-SHF-01"))).toEqual([19, 351, 22]); // y = 18 + (684 − 18)/2
    expect(dims(comp(resolved, "OBJ-KIT-001-SHT-L"))).toEqual([297, 717, 18]); // (600 − 3 − 3)/2, 720 − 3
    expect(pos(comp(resolved, "OBJ-KIT-001-SHT-L"))).toEqual([1.5, 0, 561]); // z = D + SHUTTER_BACK_GAP (fixture 1)
    expect(pos(comp(resolved, "OBJ-KIT-001-SHT-R"))).toEqual([301.5, 0, 561]);
    expect(resolved.geometry.envelope).toEqual({ min: { x: 0, y: 0, z: 0 }, size: { x: 600, y: 720, z: 579 } }); // 560 + 1 + 18
  });
  it("assigns materials by role, finish and edges from the standard", () => {
    expect(comp(resolved, "OBJ-KIT-001-SL").materialId).toBe("BOARD_BWP_18");
    expect(comp(resolved, "OBJ-KIT-001-BCK").materialId).toBe("BOARD_BACK_6");
    const sht = comp(resolved, "OBJ-KIT-001-SHT-L");
    expect(sht.materialId).toBe("BOARD_HDHMR_18");
    expect([sht.finishId, sht.finishedFaces]).toEqual(["LAMINATE_WHITE", 2]);
    expect(sht.edges).toEqual({
      TOP: { edgeBandId: "EDGE_ABS_2MM", thickness: 2, length: 297 },
      BOTTOM: { edgeBandId: "EDGE_ABS_2MM", thickness: 2, length: 297 },
      LEFT: { edgeBandId: "EDGE_ABS_2MM", thickness: 2, length: 717 },
      RIGHT: { edgeBandId: "EDGE_ABS_2MM", thickness: 2, length: 717 },
    });
    expect(comp(resolved, "OBJ-KIT-001-SL").edges).toEqual({ FRONT: { edgeBandId: "EDGE_ABS_0_8MM", thickness: 0.8, length: 720 } });
    expect(comp(resolved, "OBJ-KIT-001-SL").grainDirection).toBe("HEIGHT");
  });
  it("resolves hinges through the Hettich adapter from the fitting situation", () => {
    expect(resolved.hardwareRequirements.map((r) => [r.requirementId, r.fittingSituation.mounting, r.fittingSituation.doorWidth, r.fittingSituation.doorHeight])).toEqual([
      ["OBJ-KIT-001-SHT-L-HINGE", "FULL_OVERLAY", 297, 717],
      ["OBJ-KIT-001-SHT-R-HINGE", "FULL_OVERLAY", 297, 717],
    ]);
    expect(resolved.hardwareRequirements[0]?.fittingSituation.doorWeightKg).toBeNull(); // no density in catalog → not assumed
    expect(hw({ resolved, bom, boq })).toEqual([
      ["FIXTURE-HINGE-FO-A", 4],
      ["FIXTURE-PLATE-A", 4],
    ]);
  });
  it("aggregates BOM quantities (net, no prices)", () => {
    expect(bomItem(bom, "BOM:obj_001:BOARD:BOARD_BWP_18").quantity).toBe(1.526156);
    expect(bomItem(bom, "BOM:obj_001:BOARD:BOARD_BACK_6").quantity).toBe(0.4118);
    expect(bomItem(bom, "BOM:obj_001:BOARD:BOARD_HDHMR_18").quantity).toBe(0.425898);
    expect(bomItem(bom, "BOM:obj_001:EDGE:EDGE_ABS_0_8MM").quantity).toBe(3.13);
    expect(bomItem(bom, "BOM:obj_001:EDGE:EDGE_ABS_2MM").quantity).toBe(4.056);
    expect(bomItem(bom, "BOM:obj_001:FINISH:LAMINATE_WHITE").quantity).toBe(0.851796);
    expect(bom.items.filter((i) => i.kind === "PANEL")).toHaveLength(9);
    expect(bom.incomplete).toBe(false);
  });
  it("produces a commercial BOQ line separate from the BOM (PRD §22)", () => {
    expect(boq.items).toEqual([
      {
        boqItemId: "BOQ:dv_001:obj_001",
        sourceObjectId: "obj_001",
        productId: "KIT_BASE_STANDARD",
        itemCode: "KIT_BASE_STANDARD-600",
        description: "600 Base Cabinet",
        unit: "NOS",
        quantity: 1,
        measures: { width: 600, height: 720, depth: 560 },
        linkedBomId: "BOM:dv_001:obj_001",
      },
    ]);
  });
  it("cannot be approved: test fixture data and draft catalog", () => {
    expect(resolved.validation.canApprove).toBe(false);
    expect(codes(resolved)).toEqual(expect.arrayContaining(["CONSTRUCTION_STANDARD_NOT_APPROVED", "HARDWARE_DATA_NOT_AUTHORITATIVE", "RECIPE_NOT_APPROVED"]));
    expect(codes(resolved)).not.toContain("COMPONENT_NOT_GENERATED");
  });
});

describe("Test B — width 600 → 750", () => {
  const before = fixtureSlice();
  const after = fixtureSlice(referenceObject({ dimensions: { width: 750 } }));
  it("updates geometry and panel dimensions", () => {
    expect(pos(comp(after.resolved, "OBJ-KIT-001-SR"))).toEqual([732, 0, 0]);
    expect(dims(comp(after.resolved, "OBJ-KIT-001-BOT"))).toEqual([714, 560, 18]);
    expect(dims(comp(after.resolved, "OBJ-KIT-001-TSF"))).toEqual([714, 100, 18]);
    expect(dims(comp(after.resolved, "OBJ-KIT-001-BCK"))).toEqual([730, 710, 6]);
    expect(dims(comp(after.resolved, "OBJ-KIT-001-SHF-01"))).toEqual([712, 518, 18]);
    expect(dims(comp(after.resolved, "OBJ-KIT-001-SL"))).toEqual(dims(comp(before.resolved, "OBJ-KIT-001-SL")));
  });
  it("updates shutter widths", () => {
    expect(dims(comp(after.resolved, "OBJ-KIT-001-SHT-L"))).toEqual([372, 717, 18]); // (750 − 3 − 3)/2
    expect(pos(comp(after.resolved, "OBJ-KIT-001-SHT-R"))).toEqual([376.5, 0, 561]);
  });
  it("updates BOM and BOQ", () => {
    expect(bomItem(after.bom, "BOM:obj_001:BOARD:BOARD_BWP_18").quantity).toBe(1.717856); // 806400 + 399840 + 142800 + 368816 mm²
    expect(after.boq.items[0]?.description).toBe("750 Base Cabinet");
    expect(after.boq.items[0]?.measures.width).toBe(750);
  });
  it("changes the model fingerprint, so drawings derived from 600 are detectably stale", () => {
    expect(modelFingerprint(after.resolved)).not.toBe(modelFingerprint(before.resolved));
  });
});

describe("Test C — two shutters → one", () => {
  const after = fixtureSlice(referenceObject({ parameters: { shutterCount: 1 } }));
  it("removes one shutter and widens the other", () => {
    const shutters = after.resolved.components.filter((c) => c.componentType === "SHUTTER");
    expect(shutters.map((c) => c.componentId)).toEqual(["OBJ-KIT-001-SHT-01"]);
    expect(dims(shutters[0]!)).toEqual([597, 717, 18]); // 600 − 1.5·2
  });
  it("recalculates hinge requirements and quantities", () => {
    expect(after.resolved.hardwareRequirements.map((r) => r.requirementId)).toEqual(["OBJ-KIT-001-SHT-01-HINGE"]);
    expect(hw(after)).toEqual([
      ["FIXTURE-HINGE-FO-A", 2],
      ["FIXTURE-PLATE-A", 2],
    ]);
  });
  it("updates BOM (edge band) and keeps BOQ unit line", () => {
    expect(bomItem(after.bom, "BOM:obj_001:EDGE:EDGE_ABS_2MM").quantity).toBe(2.628); // 2·(597 + 717)
    expect(after.boq.items[0]?.description).toBe("600 Base Cabinet");
  });
});

describe("Test D — overlay → inset", () => {
  const before = fixtureSlice();
  const after = fixtureSlice(referenceObject({ parameters: { frontType: "INSET" } }));
  it("changes front geometry", () => {
    const l = comp(after.resolved, "OBJ-KIT-001-SHT-L");
    expect(dims(l)).toEqual([278.5, 680, 18]); // (564 − 4 − 3)/2, 684 − 4
    expect(pos(l)).toEqual([20, 20, 542]);
    expect(pos(comp(after.resolved, "OBJ-KIT-001-SHT-R"))).toEqual([301.5, 20, 542]);
    expect(after.resolved.geometry.envelope?.size).toEqual({ x: 600, y: 720, z: 560 });
  });
  it("re-runs Hettich compatibility and selects the inset article", () => {
    expect(after.resolved.hardwareRequirements.every((r) => r.fittingSituation.mounting === "INSET")).toBe(true);
    expect(hw(after)).toEqual([
      ["FIXTURE-HINGE-IN-A", 4],
      ["FIXTURE-PLATE-A", 4],
    ]);
  });
  it("updates BOM", () => {
    expect(bomItem(after.bom, "BOM:obj_001:BOARD:BOARD_HDHMR_18").quantity).toBe(0.37876); // 2 · 278.5 · 680
    expect(modelFingerprint(after.resolved)).not.toBe(modelFingerprint(before.resolved));
  });
  it("blocks inset shutters that would collide with shelves (construction rule)", () => {
    const tight = { ...TEST_FIXTURE_CONSTRUCTION_STANDARD, variables: { ...TEST_FIXTURE_CONSTRUCTION_STANDARD.variables, SHELF_FRONT_SETBACK: 10 } };
    const r = runSlice(referenceObject({ parameters: { frontType: "INSET" } }), tight, [createHettichAdapter(HETTICH_TEST_FIXTURE_DATASET)]);
    expect(r.resolved.validation.messages.find((m) => m.ruleId === "KBS_INSET_SHELF_CLEARS_SHUTTER")?.severity).toBe("BLOCKER");
  });
});

describe("Test E — material change", () => {
  const before = fixtureSlice();
  it("same thickness: geometry unchanged, BOM materials change", () => {
    const after = fixtureSlice(referenceObject({ parameters: { material: "BOARD_HDHMR_18" } }));
    expect(after.resolved.components.map((c) => c.geometry)).toEqual(before.resolved.components.map((c) => c.geometry));
    expect(comp(after.resolved, "OBJ-KIT-001-SL").materialId).toBe("BOARD_HDHMR_18");
    expect(after.bom.items.some((i) => i.bomItemId === "BOM:obj_001:BOARD:BOARD_BWP_18")).toBe(false);
    expect(bomItem(after.bom, "BOM:obj_001:BOARD:BOARD_HDHMR_18").quantity).toBe(1.952054); // 1.526156 + 0.425898
  });

  const catalog16: CatalogSnapshot = {
    ...LINTEL_CATALOG,
    materials: [...LINTEL_CATALOG.materials, { ...LINTEL_CATALOG.materials[0]!, materialId: "TEST_BOARD_16", name: "test 16 mm board", thickness: 16, status: "TEST_FIXTURE", source: "test" }],
  };
  const run16 = (parameters: Record<string, string | number>) =>
    resolveCabinet({ designVersion: DESIGN_VERSION, object: referenceObject({ parameters }), catalog: catalog16, standard: TEST_FIXTURE_CONSTRUCTION_STANDARD, adapters: [createHettichAdapter(HETTICH_TEST_FIXTURE_DATASET)] });

  it("different thickness without updating carcassThickness is blocked, not silently resized", () => {
    const r = run16({ material: "TEST_BOARD_16" });
    expect(r.validation.messages.find((m) => m.ruleId === "KBS_CARCASS_THICKNESS_MATCHES_MATERIAL")?.severity).toBe("BLOCKER");
    expect(codes(r)).toContain("COMPONENT_THICKNESS_MATERIAL_MISMATCH");
  });
  it("different thickness with matching carcassThickness changes geometry", () => {
    const r = run16({ material: "TEST_BOARD_16", carcassThickness: 16 });
    expect(codes(r)).not.toContain("COMPONENT_THICKNESS_MATERIAL_MISMATCH");
    expect(dims(comp(r, "OBJ-KIT-001-BOT"))).toEqual([568, 560, 16]);
    const bom = generateBom(r);
    expect(generateBoq(r, KIT_BASE_STANDARD, bom).items[0]?.description).toBe("600 Base Cabinet");
  });
});

describe("production configuration — nothing invented", () => {
  const { resolved, bom } = productionSlice();
  it("generates only components fully defined by PRD values", () => {
    expect(resolved.components.map((c) => c.componentId)).toEqual(["OBJ-KIT-001-SL", "OBJ-KIT-001-SR", "OBJ-KIT-001-BOT"]);
  });
  it("lists every undefined construction value the configuration needs", () => {
    const missing = resolved.validation.messages.filter((m) => m.code === "CONSTRUCTION_VARIABLE_UNDEFINED").map((m) => m.path);
    expect(missing).toEqual([
      "standard.variables.BACK_GROOVE_DEPTH",
      "standard.variables.BACK_REAR_OFFSET",
      "standard.variables.FRONT_BETWEEN_GAP",
      "standard.variables.FRONT_FINISHED_FACES",
      "standard.variables.OVERLAY_BOTTOM_GAP",
      "standard.variables.OVERLAY_EDGE_GAP",
      "standard.variables.OVERLAY_TOP_GAP",
      "standard.variables.SHELF_FRONT_SETBACK",
      "standard.variables.SHELF_SIDE_CLEARANCE",
      "standard.variables.SHUTTER_BACK_GAP",
      "standard.variables.TOP_RAIL_WIDTH",
    ]);
  });
  it("marks the BOM incomplete and blocks approval", () => {
    expect(bom.incomplete).toBe(true);
    expect(resolved.validation.canApprove).toBe(false);
    expect(codes(resolved)).toContain("EDGE_RULES_UNDEFINED");
  });
  it("never invents Hettich articles: with an approved-shape standard but no official data, hinges stay UNRESOLVED", () => {
    const r = runSlice(referenceObject(), TEST_FIXTURE_CONSTRUCTION_STANDARD, [createHettichAdapter(HETTICH_PRODUCTION_DATASET)]);
    expect(r.resolved.hardwareResolutions.map((h) => h.status)).toEqual(["UNRESOLVED", "UNRESOLVED"]);
    expect(codes(r.resolved)).toContain("HARDWARE_DATA_UNAVAILABLE");
    const hwItems = r.bom.items.filter((i) => i.kind === "HARDWARE");
    expect(hwItems.map((i) => [i.status, i.articleNumber, i.quantity])).toEqual([
      ["UNRESOLVED", null, 0],
      ["UNRESOLVED", null, 0],
    ]);
    expect(r.bom.incomplete).toBe(true);
  });
});
