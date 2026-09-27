import { describe, expect, it } from "vitest";
import type { DesignObject, DesignVersion, HardwareRequirement, ManufacturerAdapter, ValidationResult } from "@lintel/types";
import { KIT_BASE_STANDARD, KITCHEN_BASE_STANDARD_V1, LINTEL_CATALOG, TEST_FIXTURE_CONSTRUCTION_STANDARD, TEST_FIXTURE_EDGE_BAND_STANDARD } from "@lintel/catalog-engine";
import { assertProductionEligible, componentId, ProductionGuardError, resolveCabinet, resolveParameters } from "../src/index.js";

const dv: DesignVersion = { designVersionId: "dv_t", designId: "d", projectId: "p", versionNumber: 1, status: "DRAFT" };
const obj = (over: Partial<DesignObject> = {}): DesignObject => ({
  objectId: "o1",
  objectCode: "OBJ-T-001",
  projectId: "p",
  roomId: "r",
  objectType: "BASE_CABINET",
  productId: "KIT_BASE_STANDARD",
  transform: { x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0 },
  dimensions: { width: 600, height: 720, depth: 560 },
  parameters: {},
  status: "DRAFT",
  ...over,
});

/** Minimal adapter that always returns a single fixed line; manufacturer-agnostic test double. */
const fakeAdapter: ManufacturerAdapter = {
  manufacturer: "HETTICH",
  dataset: { datasetId: "FAKE", classification: "PRODUCTION", manufacturer: "HETTICH", sourceVersion: "t", authoritative: true },
  resolve: (r: HardwareRequirement) => ({
    requirementId: r.requirementId,
    manufacturer: "HETTICH",
    status: "RESOLVED",
    lines: [],
    candidates: [],
    quantityRuleId: null,
    drillingPatternId: null,
    dataset: { datasetId: "FAKE", classification: "PRODUCTION", manufacturer: "HETTICH", sourceVersion: "t", authoritative: true },
    messages: [],
  }),
};

const codes = (v: ValidationResult): string[] => v.messages.map((m) => m.code);

describe("resolveParameters", () => {
  it("applies defaults and records provenance", () => {
    const r = resolveParameters(KIT_BASE_STANDARD, obj({ parameters: { shelfCount: 2 } }), LINTEL_CATALOG);
    expect(r.parameters.values).toMatchObject({ width: 600, shelfCount: 2, shutterCount: 2, frontType: "OVERLAY", material: "BOARD_BWP_18" });
    expect(r.parameters.provenance.width).toBe("OBJECT");
    expect(r.parameters.provenance.shelfCount).toBe("OBJECT");
    expect(r.parameters.provenance.shutterCount).toBe("DEFAULT");
    expect(r.scope).toMatchObject({ W: 600, T: 18, TB: 6, N_SHELF: 2, FRONT_OVERLAY: true, FRONT_INSET: false, T_CARCASS_MAT: 18, T_BACK_MAT: 6, T_FRONT: 18 });
    expect(r.messages).toEqual([]);
  });
  it("rejects unknown parameters and dimension duplicates", () => {
    const r = resolveParameters(KIT_BASE_STANDARD, obj({ parameters: { colour: "red", width: 900 } }), LINTEL_CATALOG);
    expect(r.messages.map((m) => [m.code, m.severity])).toEqual([
      ["PARAMETER_UNKNOWN", "ERROR"],
      ["PARAMETER_DUPLICATES_DIMENSION", "ERROR"],
    ]);
    expect(r.parameters.values.width).toBe(600);
  });
  it("blocks invalid values and omits them from scope so dependants fail loudly", () => {
    const r = resolveParameters(KIT_BASE_STANDARD, obj({ parameters: { shutterCount: 0, shelfCount: 1.5, frontType: "SLIDING", material: "UNOBTAINIUM" } }), LINTEL_CATALOG);
    expect(r.messages.map((m) => m.code).sort()).toEqual(["MATERIAL_UNKNOWN", "PARAMETER_INVALID_TYPE", "PARAMETER_NOT_ALLOWED", "PARAMETER_OUT_OF_RANGE"]);
    expect(r.messages.every((m) => m.severity === "BLOCKER")).toBe(true);
    expect(r.scope.N_SHUTTER).toBeUndefined();
    expect(r.scope.N_SHELF).toBeUndefined();
    expect(r.scope.FRONT_OVERLAY).toBeUndefined();
    expect(r.scope.T_CARCASS_MAT).toBeUndefined();
  });
});

describe("componentId (PRD §17)", () => {
  const t = (id: string) => KITCHEN_BASE_STANDARD_V1.components.find((c) => c.templateId === id)!;
  it("is deterministic and human-readable", () => {
    expect(componentId("OBJ-KIT-001", t("SIDE_LEFT"), 0, 1)).toBe("OBJ-KIT-001-SL");
    expect(componentId("OBJ-KIT-001", t("SHELF"), 0, 1)).toBe("OBJ-KIT-001-SHF-01");
    expect(componentId("OBJ-KIT-001", t("SHUTTER_OVERLAY"), 0, 2)).toBe("OBJ-KIT-001-SHT-L");
    expect(componentId("OBJ-KIT-001", t("SHUTTER_OVERLAY"), 1, 2)).toBe("OBJ-KIT-001-SHT-R");
    expect(componentId("OBJ-KIT-001", t("SHUTTER_OVERLAY"), 0, 1)).toBe("OBJ-KIT-001-SHT-01");
    expect(componentId("OBJ-KIT-001", t("SHUTTER_OVERLAY"), 2, 3)).toBe("OBJ-KIT-001-SHT-03");
  });
});

describe("resolveCabinet guards", () => {
  const run = (o: DesignObject, adapters: readonly ManufacturerAdapter[] = [fakeAdapter], v: DesignVersion = dv) =>
    resolveCabinet({ designVersion: v, object: o, catalog: LINTEL_CATALOG, standard: TEST_FIXTURE_CONSTRUCTION_STANDARD, edgeBandStandard: TEST_FIXTURE_EDGE_BAND_STANDARD, adapters });

  it("reports a missing product without throwing", () => {
    const r = run(obj({ productId: "WARDROBE" }));
    expect(codes(r.validation)).toContain("CATALOG_REFERENCE_MISSING");
    expect(r.components).toEqual([]);
  });
  it("blocks when the object and design version belong to different projects", () => {
    expect(codes(run(obj(), [fakeAdapter], { ...dv, projectId: "other" }).validation)).toContain("TRACE_PROJECT_MISMATCH");
  });
  it("flags unsupported rotations", () => {
    expect(codes(run(obj({ transform: { x: 0, y: 0, z: 0, rotationX: 10, rotationY: 0, rotationZ: 0 } })).validation)).toContain("TRANSFORM_UNSUPPORTED");
  });
  it("blocks hardware when no adapter exists for the manufacturer", () => {
    const r = run(obj(), []);
    expect(r.hardwareResolutions.every((h) => h.status === "UNRESOLVED")).toBe(true);
    expect(codes(r.validation)).toContain("HARDWARE_ADAPTER_MISSING");
  });
  it("links each shutter to its hardware requirement", () => {
    const r = run(obj());
    const shutters = r.components.filter((c) => c.componentType === "SHUTTER");
    expect(shutters.map((c) => c.hardwareLinks)).toEqual([["OBJ-T-001-SHT-L-HINGE"], ["OBJ-T-001-SHT-R-HINGE"]]);
    expect(r.components.filter((c) => c.componentType !== "SHUTTER").every((c) => c.hardwareLinks.length === 0)).toBe(true);
  });
  it("blocks geometrically impossible dimensions", () => {
    const r = run(obj({ dimensions: { width: 30, height: 720, depth: 560 } }));
    expect(codes(r.validation)).toEqual(expect.arrayContaining(["RULE_VIOLATION", "COMPONENT_DIMENSION_INVALID"]));
  });
  it("always blocks approval for TEST_FIXTURE standards", () => {
    expect(codes(run(obj()).validation)).toContain("CONSTRUCTION_STANDARD_NOT_APPROVED");
  });
});

describe("KIT_BASE_DRAWER (Slice 2: drawer bank)", () => {
  const drawerObj = (over: Partial<DesignObject> = {}): DesignObject => obj({ productId: "KIT_BASE_DRAWER", dimensions: { width: 900, height: 720, depth: 560 }, ...over });
  const run = (o: DesignObject, adapters: readonly ManufacturerAdapter[] = [fakeAdapter]) =>
    resolveCabinet({ designVersion: dv, object: o, catalog: LINTEL_CATALOG, standard: TEST_FIXTURE_CONSTRUCTION_STANDARD, edgeBandStandard: TEST_FIXTURE_EDGE_BAND_STANDARD, adapters });

  it("resolves to KIT_BASE_DRAWER's own recipe", () => {
    const r = run(drawerObj());
    expect(r.trace.recipe.id).toBe("KITCHEN_BASE_DRAWER_V1");
    expect(r.trace.product.id).toBe("KIT_BASE_DRAWER");
  });

  it("generates the full carcass plus one front/box per drawer, for every allowed drawer count", () => {
    for (const drawerCount of [2, 3, 4]) {
      const r = run(drawerObj({ parameters: { drawerCount } }));
      expect(codes(r.validation).filter((c) => c === "COMPONENT_DIMENSION_INVALID" || c === "COMPONENT_COUNT_INVALID")).toEqual([]);
      const counts = (type: string) => r.components.filter((c) => c.componentType === type).length;
      expect(counts("DRAWER_FRONT")).toBe(drawerCount);
      expect(counts("DRAWER_BOX_SIDE")).toBe(drawerCount * 2);
      expect(counts("DRAWER_BOX_BACK")).toBe(drawerCount);
      expect(counts("DRAWER_BOTTOM")).toBe(drawerCount);
      expect(counts("SIDE_LEFT") + counts("SIDE_RIGHT") + counts("BOTTOM") + counts("TOP_SUPPORT_FRONT") + counts("TOP_SUPPORT_BACK") + counts("BACK")).toBe(6);
      expect(r.components).toHaveLength(6 + drawerCount * 5);
    }
  });

  it("stacks drawer fronts bottom to top without overlapping, inside the carcass width", () => {
    const r = run(drawerObj({ parameters: { drawerCount: 3 } }));
    const fronts = r.components.filter((c) => c.componentType === "DRAWER_FRONT").sort((a, b) => a.geometry.local.min.y - b.geometry.local.min.y);
    expect(fronts).toHaveLength(3);
    for (let i = 1; i < fronts.length; i++) {
      const below = fronts[i - 1]!;
      const above = fronts[i]!;
      expect(below.geometry.local.min.y + below.geometry.local.size.y).toBeLessThanOrEqual(above.geometry.local.min.y + 1e-9);
    }
    for (const f of fronts) {
      expect(f.geometry.local.min.x).toBeGreaterThanOrEqual(0);
      expect(f.geometry.local.min.x + f.geometry.local.size.x).toBeLessThanOrEqual(900);
    }
  });

  it("switches every front from overlay to inset together (Slice 2 equivalent of PRD §43 test D)", () => {
    const overlay = run(drawerObj({ parameters: { frontType: "OVERLAY" } })).components.filter((c) => c.componentType === "DRAWER_FRONT");
    const inset = run(drawerObj({ parameters: { frontType: "INSET" } })).components.filter((c) => c.componentType === "DRAWER_FRONT");
    expect(overlay.every((c) => c.geometry.local.min.z > 560)).toBe(true);
    expect(inset.every((c) => c.geometry.local.min.z < 560)).toBe(true);
  });

  it("regenerates geometry (and the model fingerprint) when the drawer count changes", async () => {
    const { modelFingerprint } = await import("../src/index.js");
    const three = run(drawerObj({ parameters: { drawerCount: 3 } }));
    const four = run(drawerObj({ parameters: { drawerCount: 4 } }));
    expect(modelFingerprint(three)).not.toBe(modelFingerprint(four));
    expect(three.components.filter((c) => c.componentType === "DRAWER_FRONT")).toHaveLength(3);
    expect(four.components.filter((c) => c.componentType === "DRAWER_FRONT")).toHaveLength(4);
  });

  it("requests a runner for every drawer box side (PRD §28), never for the fronts or the carcass", () => {
    const r = run(drawerObj({ parameters: { drawerCount: 3 } }));
    const runnerLinks = r.components.filter((c) => c.componentType === "DRAWER_BOX_SIDE").flatMap((c) => c.hardwareLinks);
    expect(runnerLinks).toHaveLength(6);
    expect(r.components.filter((c) => c.componentType !== "DRAWER_BOX_SIDE").every((c) => c.hardwareLinks.length === 0)).toBe(true);
    expect(r.hardwareRequirements.filter((h) => h.category === "RUNNER")).toHaveLength(6);
    expect(r.hardwareRequirements.every((h) => h.category !== "HINGE")).toBe(true);
  });

  it("blocks hardware when no adapter exists for the manufacturer, exactly like the shutter cabinet", () => {
    const r = run(drawerObj(), []);
    expect(r.hardwareResolutions.every((h) => h.status === "UNRESOLVED")).toBe(true);
    expect(codes(r.validation)).toContain("HARDWARE_ADAPTER_MISSING");
  });

  it("Slice 2.1: an explicit drawer height changes only that drawer and the bank's last (remainder) drawer, never the untouched ones", () => {
    const heightsTopToBottom = (r: ReturnType<typeof run>) =>
      r.components.filter((c) => c.componentType === "DRAWER_FRONT").sort((a, b) => b.geometry.local.min.y - a.geometry.local.min.y).map((c) => c.dimensions.height);

    const base = run(drawerObj({ parameters: { drawerCount: 3, drawerHeight1: 120, drawerHeight2: 180 } }));
    const baseHeights = heightsTopToBottom(base);
    expect(baseHeights[0]).toBeCloseTo(120, 9);
    expect(baseHeights[1]).toBeCloseTo(180, 9);
    expect(baseHeights[2]).toBeGreaterThan(0);

    // Raise the middle drawer (index 1) from 180 to 240: only index 1 and the last (remainder) drawer move.
    const changed = run(drawerObj({ parameters: { drawerCount: 3, drawerHeight1: 120, drawerHeight2: 240 } }));
    const changedHeights = heightsTopToBottom(changed);
    expect(changedHeights[0]).toBeCloseTo(120, 9);
    expect(changedHeights[1]).toBeCloseTo(240, 9);
    expect(changedHeights[2]).toBeCloseTo(baseHeights[2]! - 60, 9);

    // The total internal opening the three fronts (plus their two gaps) occupy is unchanged either way.
    const totalSpan = (hs: readonly number[]) => hs.reduce((a, b) => a + b, 0);
    expect(totalSpan(changedHeights)).toBeCloseTo(totalSpan(baseHeights), 9);
  });

  it("keeps the drawer box within the carcass and off the top rail", () => {
    const r = run(drawerObj({ parameters: { drawerCount: 4 } }));
    const topRail = r.components.find((c) => c.componentType === "TOP_SUPPORT_BACK")!;
    for (const c of r.components.filter((x) => x.componentType === "DRAWER_BOX_SIDE" || x.componentType === "DRAWER_BOX_BACK" || x.componentType === "DRAWER_BOTTOM")) {
      expect(c.geometry.local.min.y + c.geometry.local.size.y).toBeLessThanOrEqual(topRail.geometry.local.min.y + 1e-9);
      expect(c.dimensions.width).toBeGreaterThan(0);
      expect(c.dimensions.height).toBeGreaterThan(0);
    }
  });
});

describe("KIT_BASE_PULLOUT (Slice 5 step 1: pull-out cabinet)", () => {
  const pulloutObj = (over: Partial<DesignObject> = {}): DesignObject => obj({ productId: "KIT_BASE_PULLOUT", dimensions: { width: 300, height: 720, depth: 560 }, ...over });
  const run = (o: DesignObject, adapters: readonly ManufacturerAdapter[] = [fakeAdapter]) =>
    resolveCabinet({ designVersion: dv, object: o, catalog: LINTEL_CATALOG, standard: TEST_FIXTURE_CONSTRUCTION_STANDARD, edgeBandStandard: TEST_FIXTURE_EDGE_BAND_STANDARD, adapters });

  it("resolves to KIT_BASE_PULLOUT's own recipe", () => {
    const r = run(pulloutObj());
    expect(r.trace.recipe.id).toBe("KITCHEN_BASE_PULLOUT_V1");
    expect(r.trace.product.id).toBe("KIT_BASE_PULLOUT");
  });

  it("generates the carcass, one shutter and one pull-out frame (2 sides + a tray) per pullout count", () => {
    for (const pulloutCount of [1, 2, 3, 4]) {
      const r = run(pulloutObj({ parameters: { pulloutCount, shutterCount: 1 } }));
      expect(codes(r.validation).filter((c) => c === "COMPONENT_DIMENSION_INVALID" || c === "COMPONENT_COUNT_INVALID")).toEqual([]);
      const counts = (type: string) => r.components.filter((c) => c.componentType === type).length;
      expect(counts("SHUTTER")).toBe(1);
      expect(counts("PULLOUT_FRAME_SIDE")).toBe(pulloutCount * 2);
      expect(counts("PULLOUT_TRAY")).toBe(pulloutCount);
      expect(counts("SIDE_LEFT") + counts("SIDE_RIGHT") + counts("BOTTOM") + counts("TOP_SUPPORT_FRONT") + counts("TOP_SUPPORT_BACK") + counts("BACK")).toBe(6);
      expect(r.components).toHaveLength(6 + 1 + pulloutCount * 3);
    }
  });

  it("stacks pull-out frames bottom to top without overlapping, inside the carcass width", () => {
    const r = run(pulloutObj({ parameters: { pulloutCount: 3 } }));
    const trays = r.components.filter((c) => c.componentType === "PULLOUT_TRAY").sort((a, b) => a.geometry.local.min.y - b.geometry.local.min.y);
    expect(trays).toHaveLength(3);
    for (let i = 1; i < trays.length; i++) {
      const below = trays[i - 1]!;
      const above = trays[i]!;
      expect(below.geometry.local.min.y + below.geometry.local.size.y).toBeLessThanOrEqual(above.geometry.local.min.y + 1e-9);
    }
    for (const c of r.components.filter((x) => x.componentType === "PULLOUT_FRAME_SIDE" || x.componentType === "PULLOUT_TRAY")) {
      expect(c.geometry.local.min.x).toBeGreaterThanOrEqual(0);
      expect(c.geometry.local.min.x + c.geometry.local.size.x).toBeLessThanOrEqual(300);
      expect(c.dimensions.width).toBeGreaterThan(0);
      expect(c.dimensions.height).toBeGreaterThan(0);
    }
  });

  it("requests one hinge per shutter and one runner per pull-out frame side, never mixed up", () => {
    const r = run(pulloutObj({ parameters: { pulloutCount: 3, shutterCount: 1 } }));
    expect(r.hardwareRequirements.filter((h) => h.category === "HINGE")).toHaveLength(1);
    expect(r.hardwareRequirements.filter((h) => h.category === "RUNNER")).toHaveLength(6);
    const runnerLinks = r.components.filter((c) => c.componentType === "PULLOUT_FRAME_SIDE").flatMap((c) => c.hardwareLinks);
    expect(runnerLinks).toHaveLength(6);
    expect(r.components.filter((c) => c.componentType !== "PULLOUT_FRAME_SIDE" && c.componentType !== "SHUTTER").every((c) => c.hardwareLinks.length === 0)).toBe(true);
  });

  it("blocks hardware when no adapter exists for the manufacturer, exactly like the other cabinets", () => {
    const r = run(pulloutObj(), []);
    expect(r.hardwareResolutions.every((h) => h.status === "UNRESOLVED")).toBe(true);
    expect(codes(r.validation)).toContain("HARDWARE_ADAPTER_MISSING");
  });

  it("regenerates geometry (and the model fingerprint) when the pull-out count changes", async () => {
    const { modelFingerprint } = await import("../src/index.js");
    const two = run(pulloutObj({ parameters: { pulloutCount: 2 } }));
    const three = run(pulloutObj({ parameters: { pulloutCount: 3 } }));
    expect(modelFingerprint(two)).not.toBe(modelFingerprint(three));
    expect(two.components.filter((c) => c.componentType === "PULLOUT_TRAY")).toHaveLength(2);
    expect(three.components.filter((c) => c.componentType === "PULLOUT_TRAY")).toHaveLength(3);
  });
});

describe("KIT_BASE_SINK (Slice 5 step 4: sink cabinet)", () => {
  const sinkObj = (over: Partial<DesignObject> = {}): DesignObject => obj({ productId: "KIT_BASE_SINK", dimensions: { width: 600, height: 720, depth: 560 }, ...over });
  const run = (o: DesignObject, adapters: readonly ManufacturerAdapter[] = [fakeAdapter]) =>
    resolveCabinet({ designVersion: dv, object: o, catalog: LINTEL_CATALOG, standard: TEST_FIXTURE_CONSTRUCTION_STANDARD, edgeBandStandard: TEST_FIXTURE_EDGE_BAND_STANDARD, adapters });

  it("resolves to KIT_BASE_SINK's own recipe", () => {
    const r = run(sinkObj());
    expect(r.trace.recipe.id).toBe("KITCHEN_BASE_SINK_V1");
    expect(r.trace.product.id).toBe("KIT_BASE_SINK");
  });

  it("generates the carcass with no rear top rail and no waste-bin internal by default (internalConfig OPEN)", () => {
    const r = run(sinkObj({ parameters: { shutterCount: 1 } }));
    expect(codes(r.validation).filter((c) => c === "COMPONENT_DIMENSION_INVALID" || c === "COMPONENT_COUNT_INVALID")).toEqual([]);
    const counts = (type: string) => r.components.filter((c) => c.componentType === type).length;
    expect(counts("SHUTTER")).toBe(1);
    expect(counts("TOP_SUPPORT_BACK")).toBe(0);
    expect(counts("PULLOUT_FRAME_SIDE")).toBe(0);
    expect(counts("PULLOUT_TRAY")).toBe(0);
    expect(counts("SIDE_LEFT") + counts("SIDE_RIGHT") + counts("BOTTOM") + counts("TOP_SUPPORT_FRONT") + counts("BACK")).toBe(5);
    expect(r.components).toHaveLength(5 + 1);
  });

  it("generates a waste-bin frame (2 sides + a tray) centred in the internal height when internalConfig is WASTE_BIN", () => {
    const r = run(sinkObj({ parameters: { internalConfig: "WASTE_BIN", shutterCount: 1 } }));
    expect(codes(r.validation).filter((c) => c === "COMPONENT_DIMENSION_INVALID" || c === "COMPONENT_COUNT_INVALID")).toEqual([]);
    const counts = (type: string) => r.components.filter((c) => c.componentType === type).length;
    expect(counts("PULLOUT_FRAME_SIDE")).toBe(2);
    expect(counts("PULLOUT_TRAY")).toBe(1);
    const trayBottomY = r.components.find((c) => c.componentType === "PULLOUT_TRAY")!.geometry.local.min.y;
    const carcassTop = r.scope.H as number;
    const T = r.scope.T as number;
    expect(trayBottomY).toBeGreaterThan(T);
    expect(trayBottomY).toBeLessThan(carcassTop - T);
  });

  it("requests one hinge per shutter and one runner pair for the waste-bin frame only when present", () => {
    const open = run(sinkObj({ parameters: { internalConfig: "OPEN", shutterCount: 1 } }));
    expect(open.hardwareRequirements.filter((h) => h.category === "HINGE")).toHaveLength(1);
    expect(open.hardwareRequirements.filter((h) => h.category === "RUNNER")).toHaveLength(0);
    const wasteBin = run(sinkObj({ parameters: { internalConfig: "WASTE_BIN", shutterCount: 1 } }));
    expect(wasteBin.hardwareRequirements.filter((h) => h.category === "HINGE")).toHaveLength(1);
    expect(wasteBin.hardwareRequirements.filter((h) => h.category === "RUNNER")).toHaveLength(2);
  });

  it("regenerates geometry (and the model fingerprint) when internalConfig changes", async () => {
    const { modelFingerprint } = await import("../src/index.js");
    const open = run(sinkObj({ parameters: { internalConfig: "OPEN" } }));
    const wasteBin = run(sinkObj({ parameters: { internalConfig: "WASTE_BIN" } }));
    expect(modelFingerprint(open)).not.toBe(modelFingerprint(wasteBin));
  });

  it("produces no COUNTERTOP cutout (Slice 5 step 6): the sink has no appliance parameter, and no sourced bowl dimension exists yet", () => {
    const r = run(sinkObj());
    expect(r.cutouts).toEqual([]);
  });
});

describe("KIT_BASE_HOB (Slice 5 step 5: hob cabinet)", () => {
  const hobObj = (over: Partial<DesignObject> = {}): DesignObject => obj({ productId: "KIT_BASE_HOB", dimensions: { width: 600, height: 720, depth: 560 }, ...over });
  const run = (o: DesignObject, adapters: readonly ManufacturerAdapter[] = [fakeAdapter]) =>
    resolveCabinet({ designVersion: dv, object: o, catalog: LINTEL_CATALOG, standard: TEST_FIXTURE_CONSTRUCTION_STANDARD, edgeBandStandard: TEST_FIXTURE_EDGE_BAND_STANDARD, adapters });

  it("resolves to KIT_BASE_HOB's own recipe", () => {
    const r = run(hobObj());
    expect(r.trace.recipe.id).toBe("KITCHEN_BASE_HOB_V1");
    expect(r.trace.product.id).toBe("KIT_BASE_HOB");
  });

  it("generates the carcass with no top rails at all (hob-body clearance)", () => {
    const r = run(hobObj({ parameters: { shutterCount: 1 } }));
    expect(codes(r.validation).filter((c) => c === "COMPONENT_DIMENSION_INVALID" || c === "COMPONENT_COUNT_INVALID")).toEqual([]);
    const counts = (type: string) => r.components.filter((c) => c.componentType === type).length;
    expect(counts("SHUTTER")).toBe(1);
    expect(counts("TOP_SUPPORT_FRONT")).toBe(0);
    expect(counts("TOP_SUPPORT_BACK")).toBe(0);
    expect(counts("SIDE_LEFT") + counts("SIDE_RIGHT") + counts("BOTTOM") + counts("BACK")).toBe(4);
    expect(r.components).toHaveLength(4 + 1);
  });

  it("resolves the referenced hob appliance (the bom-engine's join point for its own APPLIANCE line)", () => {
    const r = run(hobObj());
    expect(r.appliances).toEqual([{ parameterKey: "hob", applianceId: "HOB_REFERENCE_60CM", manufacturer: null, model: null }]);
  });

  it("requests one hinge per shutter and no other hardware", () => {
    const r = run(hobObj({ parameters: { shutterCount: 2 } }));
    expect(r.hardwareRequirements.filter((h) => h.category === "HINGE")).toHaveLength(2);
    expect(r.hardwareRequirements.filter((h) => h.category !== "HINGE")).toHaveLength(0);
  });

  it("derives one COUNTERTOP cutout from the referenced hob appliance's own installation envelope (Slice 5 step 6)", () => {
    const r = run(hobObj());
    expect(r.cutouts).toEqual([{
      cutoutId: "o1-CUTOUT-hob", target: "COUNTERTOP", shape: "RECTANGLE",
      widthMm: 560, depthMm: 490, position: { xMm: 0, zMm: 0 },
      cornerRadiusMm: null, clearance: [], sourceApplianceId: "HOB_REFERENCE_60CM", edgeTreatment: null,
    }]);
  });

  it("produces no cutout for an OVEN-category appliance reference (Slice 5 step 6: only a HOB gets a COUNTERTOP cutout — an oven's own bay is a structural void, not a worktop hole)", () => {
    const ovenObj = obj({ productId: "KIT_TALL_OVEN", dimensions: { width: 600, height: 2000, depth: 560 } });
    const r = resolveCabinet({ designVersion: dv, object: ovenObj, catalog: LINTEL_CATALOG, standard: TEST_FIXTURE_CONSTRUCTION_STANDARD, edgeBandStandard: TEST_FIXTURE_EDGE_BAND_STANDARD, adapters: [fakeAdapter] });
    expect(r.cutouts).toEqual([]);
  });
});

describe("assertProductionEligible", () => {
  const ok: ValidationResult = { messages: [], counts: { BLOCKER: 0, ERROR: 0, WARNING: 0, INFO: 0 }, canApprove: true };
  const blocked: ValidationResult = { ...ok, counts: { ...ok.counts, BLOCKER: 1 }, canApprove: false };
  it("rejects non-approved design versions", () => {
    for (const status of ["DRAFT", "IN_REVIEW", "CHANGES_REQUIRED", "SUPERSEDED"] as const) {
      expect(() => {
        assertProductionEligible({ ...dv, status }, ok);
      }).toThrow(ProductionGuardError);
    }
  });
  it("rejects approved versions that still have blockers", () => {
    expect(() => {
      assertProductionEligible({ ...dv, status: "APPROVED" }, blocked);
    }).toThrow(/BLOCKER/);
  });
  it("accepts APPROVED / LOCKED versions without blockers", () => {
    expect(() => {
      assertProductionEligible({ ...dv, status: "APPROVED" }, ok);
    }).not.toThrow();
    expect(() => {
      assertProductionEligible({ ...dv, status: "LOCKED" }, ok);
    }).not.toThrow();
  });
});

describe("stableStringify / modelFingerprint", () => {
  it("ignores object key order", async () => {
    const { stableStringify } = await import("../src/index.js");
    expect(stableStringify({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 2 } })).toBe(stableStringify({ a: { c: 2, d: [1, { y: 2, z: 1 }] }, b: 1 }));
  });
  it("is stable for identical models and changes when the model changes", async () => {
    const { modelFingerprint } = await import("../src/index.js");
    const run = (width: number) =>
      resolveCabinet({ designVersion: dv, object: obj({ dimensions: { width, height: 720, depth: 560 } }), catalog: LINTEL_CATALOG, standard: TEST_FIXTURE_CONSTRUCTION_STANDARD, edgeBandStandard: TEST_FIXTURE_EDGE_BAND_STANDARD, adapters: [fakeAdapter] });
    expect(modelFingerprint(run(600))).toBe(modelFingerprint(run(600)));
    expect(modelFingerprint(run(600))).not.toBe(modelFingerprint(run(750)));
    expect(modelFingerprint(run(600))).toMatch(/^[0-9a-f]{14}$/);
  });
});
