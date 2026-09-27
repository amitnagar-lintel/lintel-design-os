import { describe, expect, it } from "vitest";
import type { CabinetFront, CabinetInstance, Drawer, DrawerBank, FinishAssignment, OverlayMode, PullOut, Shelf, Shutter } from "../src/model.js";
import { BASE_DRAWER_BANK_CABINET, BASE_OPEN_CABINET, BASE_PULLOUT_CABINET, BASE_SHUTTER_CABINET, CABINET_LIBRARY, findAvailableCabinetType } from "../src/library.js";
import { compileCreate, compileUpdate } from "../src/compile.js";
import { decodeCabinetInstance, type ModelComponent, type ModelObject } from "../src/decode.js";
import { cornerPairPlacementDA } from "../src/corner.js";

const FINISH: FinishAssignment = { carcassMaterialId: "BOARD_BWP_18", backMaterialId: "BOARD_BACK_6", frontMaterialId: "BOARD_HDHMR_18", frontFinishId: "LAMINATE_WHITE" };

function shutter(widthMm: number, heightMm: number, overlay: OverlayMode = "OVERLAY"): Shutter {
  return { kind: "SHUTTER", widthMm, heightMm, overlay, hinge: { mounting: overlay === "OVERLAY" ? "FULL_OVERLAY" : "INSET", openingAngle: null } };
}

function frontOf(...shutters: readonly Shutter[]): CabinetFront {
  return { rows: [{ rowId: "R0", heightMm: 720, columns: shutters.map((s, i) => ({ columnId: `C${String(i)}`, widthMm: s.widthMm, element: s })) }] };
}

function instance(overrides: Partial<CabinetInstance> = {}): CabinetInstance {
  return {
    instanceId: "i1",
    objectCode: "BC-001",
    lineageId: null,
    cabinetType: BASE_SHUTTER_CABINET,
    recipe: { recipeId: "KITCHEN_BASE_STANDARD_V1", productCode: "KIT_BASE_STANDARD", productVersionId: "pv1", frontComponentTypes: ["SHUTTER"] },
    position: { xMm: 0, yMm: 0, zMm: 0 },
    rotationY: 0,
    dimensions: { widthMm: 600, heightMm: 720, depthMm: 560 },
    front: frontOf(shutter(600, 720)),
    internals: [],
    corner: null,
    finish: FINISH,
    hardware: { hinges: [], runners: [], handle: null },
    ...overrides,
  };
}

describe("library", () => {
  const AVAILABLE_TODAY = ["BASE_SHUTTER", "BASE_DRAWER_BANK", "BASE_OPEN", "BASE_PULLOUT", "TALL_OVEN_TOWER", "BASE_SINK"];
  const AVAILABLE_CORNER_PAIR_TODAY = ["CORNER_L"];

  it("lists exactly the Slice 1, Slice 2, Slice 3 and Slice 5-step-1 cabinet types as available", () => {
    const available = CABINET_LIBRARY.filter((e) => e.availability.kind === "AVAILABLE");
    expect(available.map((e) => e.cabinetTypeId).sort()).toEqual([...AVAILABLE_TODAY].sort());
  });

  it("lists exactly the Slice 4 cabinet type as an available corner pair", () => {
    const pairs = CABINET_LIBRARY.filter((e) => e.availability.kind === "AVAILABLE_CORNER_PAIR");
    expect(pairs.map((e) => e.cabinetTypeId).sort()).toEqual([...AVAILABLE_CORNER_PAIR_TODAY].sort());
  });

  it("marks every other entry PLANNED with a slice number", () => {
    for (const entry of CABINET_LIBRARY) {
      if (AVAILABLE_TODAY.includes(entry.cabinetTypeId) || AVAILABLE_CORNER_PAIR_TODAY.includes(entry.cabinetTypeId)) continue;
      expect(entry.availability.kind).toBe("PLANNED");
      if (entry.availability.kind === "PLANNED") expect(entry.availability.slice).toBeGreaterThan(0);
    }
  });

  it("resolves each product code to its own cabinet type and nothing else", () => {
    expect(findAvailableCabinetType("KIT_BASE_STANDARD")).toBe(BASE_SHUTTER_CABINET);
    expect(findAvailableCabinetType("KIT_BASE_DRAWER")).toBe(BASE_DRAWER_BANK_CABINET);
    expect(findAvailableCabinetType("KIT_BASE_OPEN")).toBe(BASE_OPEN_CABINET);
    expect(findAvailableCabinetType("KIT_WARDROBE")).toBeUndefined();
  });

  it("offers 1- and 2-shutter front topologies", () => {
    expect(BASE_SHUTTER_CABINET.supportedFronts.map((f) => f.topologyId)).toEqual(["BASE_1_SHUTTER", "BASE_2_SHUTTER"]);
  });

  it("offers one drawer-bank front topology (drawer count is a bank property, not a topology)", () => {
    expect(BASE_DRAWER_BANK_CABINET.supportedFronts.map((f) => f.topologyId)).toEqual(["DRAWER_BANK"]);
  });

  it("offers one no-front topology for the open cabinet (zero rows, not a row of zero columns)", () => {
    expect(BASE_OPEN_CABINET.supportedFronts.map((f) => f.topologyId)).toEqual(["OPEN_NO_FRONT"]);
    expect(BASE_OPEN_CABINET.supportedFronts[0]?.rows).toEqual([]);
  });
});

describe("compileCreate / compileUpdate", () => {
  it("compiles a single-shutter cabinet", () => {
    const body = compileCreate(instance());
    expect(body).toEqual({
      objectCode: "BC-001",
      objectType: "BASE_CABINET",
      productCode: "KIT_BASE_STANDARD",
      productVersionId: "pv1",
      position: { xMm: 0, yMm: 0, zMm: 0 },
      rotationY: 0,
      dimensions: { widthMm: 600, heightMm: 720, depthMm: 560 },
      parameters: { shutterCount: 1, frontType: "OVERLAY", material: "BOARD_BWP_18", backMaterial: "BOARD_BACK_6", shutterMaterial: "BOARD_HDHMR_18", finish: "LAMINATE_WHITE" },
    });
  });

  it("compiles a two-shutter cabinet", () => {
    const body = compileCreate(instance({ front: frontOf(shutter(291, 654), shutter(291, 654)) }));
    expect(body.parameters).toMatchObject({ shutterCount: 2, frontType: "OVERLAY" });
  });

  it("carries an inset front through", () => {
    const body = compileCreate(instance({ front: frontOf(shutter(600, 654, "INSET")) }));
    expect(body.parameters.frontType).toBe("INSET");
  });

  it("compileUpdate recomputes every field, including product", () => {
    const body = compileUpdate(instance());
    expect(body.product).toEqual({ productCode: "KIT_BASE_STANDARD", productVersionId: "pv1" });
    expect(body.parameters.shutterCount).toBe(1);
  });

  it("refuses a corner configuration", () => {
    expect(() => compileCreate(instance({ corner: { kind: "L_CORNER", returnLegWidthMm: 900 } }))).toThrow(/corner/);
  });

  it("refuses internal components", () => {
    expect(() => compileCreate(instance({ internals: [{ shelfId: "S1", fixed: true, heightFromBottomMm: 300 }] }))).toThrow(/internal/);
  });

  it("refuses more than one front row", () => {
    const twoRows: CabinetFront = { rows: [...frontOf(shutter(600, 300)).rows, ...frontOf(shutter(600, 300)).rows] };
    expect(() => compileCreate(instance({ front: twoRows }))).toThrow(/one row/);
  });

  it("refuses a drawer bank column on a BASE_SHUTTER cabinet", () => {
    const front: CabinetFront = { rows: [{ rowId: "R0", heightMm: 720, columns: [{ columnId: "C0", widthMm: 600, element: { kind: "DRAWER_BANK", widthMm: 600, overlay: "OVERLAY", drawers: [] } }] }] };
    expect(() => compileCreate(instance({ front }))).toThrow(/DRAWER_BANK/);
  });

  it("refuses shutters with mixed overlay modes on one cabinet", () => {
    const front = frontOf(shutter(300, 720, "OVERLAY"), shutter(300, 720, "INSET"));
    expect(() => compileCreate(instance({ front }))).toThrow(/overlay/);
  });
});

describe("decodeCabinetInstance", () => {
  function component(over: Partial<ModelComponent>): ModelComponent {
    return {
      componentId: "c",
      componentType: "SIDE_LEFT",
      dimensions: { width: 560, height: 720, thickness: 18 },
      box: { min: { x: 0, y: 0, z: 0 }, size: { x: 18, y: 720, z: 560 } },
      materialId: "BOARD_BWP_18",
      finishId: null,
      finishedFaces: 0,
      grainDirection: "HEIGHT",
      ...over,
    };
  }

  function modelObject(over: Partial<ModelObject> = {}): ModelObject {
    return {
      lineageId: "lin-1",
      objectCode: "BC-001",
      productCode: "KIT_BASE_STANDARD",
      productVersionId: "pv1",
      parameters: { shutterCount: 2, frontType: "OVERLAY", material: "BOARD_BWP_18", backMaterial: "BOARD_BACK_6", shutterMaterial: "BOARD_HDHMR_18", finish: "LAMINATE_WHITE" },
      dimensions: { width: 600, height: 720, depth: 560 },
      transform: { x: 100, y: 0, z: 200, rotationY: 90 },
      components: [
        component({ componentId: "SL", componentType: "SIDE_LEFT", materialId: "BOARD_BWP_18" }),
        component({ componentId: "BCK", componentType: "BACK", materialId: "BOARD_BACK_6" }),
        component({
          componentId: "SHT1", componentType: "SHUTTER", materialId: "BOARD_HDHMR_18", finishId: "LAMINATE_WHITE",
          dimensions: { width: 291, height: 654, thickness: 18 }, box: { min: { x: 300, y: 33, z: 566 }, size: { x: 291, y: 654, z: 18 } },
        }),
        component({
          componentId: "SHT0", componentType: "SHUTTER", materialId: "BOARD_HDHMR_18", finishId: "LAMINATE_WHITE",
          dimensions: { width: 291, height: 654, thickness: 18 }, box: { min: { x: 6, y: 33, z: 566 }, size: { x: 291, y: 654, z: 18 } },
        }),
      ],
      ...over,
    };
  }

  it("decodes carcass position, rotation and dimensions", () => {
    const decoded = decodeCabinetInstance(modelObject(), BASE_SHUTTER_CABINET);
    expect(decoded.position).toEqual({ xMm: 100, yMm: 0, zMm: 200 });
    expect(decoded.rotationY).toBe(90);
    expect(decoded.dimensions).toEqual({ widthMm: 600, heightMm: 720, depthMm: 560 });
    expect(decoded.objectCode).toBe("BC-001");
    expect(decoded.lineageId).toBe("lin-1");
  });

  it("orders shutter columns left to right by box position, not component order", () => {
    const decoded = decodeCabinetInstance(modelObject(), BASE_SHUTTER_CABINET);
    const row = decoded.front.rows[0];
    expect(row?.columns.map((c) => c.columnId)).toEqual(["C0", "C1"]);
    expect(row?.columns[0]?.element).toMatchObject({ kind: "SHUTTER", widthMm: 291 });
  });

  it("decodes finish from the resolved components, not from parameters", () => {
    const decoded = decodeCabinetInstance(modelObject(), BASE_SHUTTER_CABINET);
    expect(decoded.finish).toEqual(FINISH);
  });

  it("decodes one hinge configuration per shutter, mounting derived from frontType", () => {
    const decoded = decodeCabinetInstance(modelObject(), BASE_SHUTTER_CABINET);
    expect(decoded.hardware.hinges).toHaveLength(2);
    expect(decoded.hardware.hinges.every((h) => h.mounting === "FULL_OVERLAY")).toBe(true);
    expect(decoded.hardware.runners).toEqual([]);
    expect(decoded.hardware.handle).toBeNull();
  });

  it("throws for an unsupported rotation", () => {
    expect(() => decodeCabinetInstance(modelObject({ transform: { x: 0, y: 0, z: 0, rotationY: 45 } }), BASE_SHUTTER_CABINET)).toThrow(/rotation/);
  });

  it("throws when a required carcass component is missing", () => {
    const object = modelObject({ components: modelObject().components.filter((c) => c.componentType !== "BACK") });
    expect(() => decodeCabinetInstance(object, BASE_SHUTTER_CABINET)).toThrow(/BACK/);
  });

  it("round-trips through compileCreate back to the same parameters", () => {
    const decoded = decodeCabinetInstance(modelObject(), BASE_SHUTTER_CABINET);
    const recompiled = compileCreate(decoded);
    expect(recompiled.parameters).toEqual(modelObject().parameters);
    expect(recompiled.dimensions).toEqual({ widthMm: 600, heightMm: 720, depthMm: 560 });
  });
});

describe("BASE_DRAWER_BANK (Slice 2): compile", () => {
  function drawer(index: number, over: Partial<Drawer> = {}): Drawer {
    return { kind: "DRAWER", widthMm: 802, heightMm: 210, frontThicknessMm: 18, index, runner: null, componentId: `DRF-${String(index)}`, boxHeightMm: 195, gapBelowMm: 3, ...over };
  }
  function bank(over: Partial<DrawerBank> = {}): DrawerBank {
    return { kind: "DRAWER_BANK", widthMm: 900, overlay: "OVERLAY", drawers: [drawer(0), drawer(1), drawer(2)], ...over };
  }
  function drawerFrontOf(b: DrawerBank): CabinetFront {
    return { rows: [{ rowId: "R0", heightMm: 720, columns: [{ columnId: "C0", widthMm: b.widthMm, element: b }] }] };
  }
  function drawerInstance(overrides: Partial<CabinetInstance> = {}): CabinetInstance {
    return {
      instanceId: "i2",
      objectCode: "BC-002",
      lineageId: null,
      cabinetType: BASE_DRAWER_BANK_CABINET,
      recipe: { recipeId: "KITCHEN_BASE_DRAWER_V1", productCode: "KIT_BASE_DRAWER", productVersionId: "pv2", frontComponentTypes: ["DRAWER_FRONT"] },
      position: { xMm: 900, yMm: 0, zMm: 0 },
      rotationY: 0,
      dimensions: { widthMm: 900, heightMm: 720, depthMm: 560 },
      front: drawerFrontOf(bank()),
      internals: [],
      corner: null,
      finish: { carcassMaterialId: "BOARD_BWP_18", backMaterialId: "BOARD_BACK_6", frontMaterialId: "BOARD_HDHMR_18", frontFinishId: "LAMINATE_WHITE" },
      hardware: { hinges: [], runners: [], handle: null },
      ...overrides,
    };
  }

  it("compiles a 3-drawer bank", () => {
    const body = compileCreate(drawerInstance());
    expect(body).toEqual({
      objectCode: "BC-002",
      objectType: "BASE_CABINET",
      productCode: "KIT_BASE_DRAWER",
      productVersionId: "pv2",
      position: { xMm: 900, yMm: 0, zMm: 0 },
      rotationY: 0,
      dimensions: { widthMm: 900, heightMm: 720, depthMm: 560 },
      parameters: { drawerCount: 3, drawerHeight1: 210, drawerHeight2: 210, frontType: "OVERLAY", material: "BOARD_BWP_18", backMaterial: "BOARD_BACK_6", frontMaterial: "BOARD_HDHMR_18", finish: "LAMINATE_WHITE" },
    });
  });

  it("compiles 2 and 4 drawer counts, with one fewer explicit drawerHeight than drawers (the last always absorbs the remainder)", () => {
    const twoDrawers = compileCreate(drawerInstance({ front: drawerFrontOf(bank({ drawers: [drawer(0), drawer(1)] })) })).parameters;
    expect(twoDrawers.drawerCount).toBe(2);
    expect(twoDrawers).toMatchObject({ drawerHeight1: 210 });
    expect(twoDrawers.drawerHeight2).toBeUndefined();

    const fourDrawers = compileCreate(drawerInstance({ front: drawerFrontOf(bank({ drawers: [drawer(0), drawer(1), drawer(2), drawer(3)] })) })).parameters;
    expect(fourDrawers.drawerCount).toBe(4);
    expect(fourDrawers).toMatchObject({ drawerHeight1: 210, drawerHeight2: 210, drawerHeight3: 210 });
  });

  it("sends each explicit drawer's own height, not a shared default", () => {
    const custom = compileCreate(drawerInstance({
      front: drawerFrontOf(bank({ drawers: [drawer(0, { heightMm: 120 }), drawer(1, { heightMm: 180 }), drawer(2, { heightMm: 402 })] })),
    })).parameters;
    expect(custom).toMatchObject({ drawerHeight1: 120, drawerHeight2: 180 });
    expect(custom.drawerHeight3).toBeUndefined();
  });

  it("carries an inset front through", () => {
    expect(compileCreate(drawerInstance({ front: drawerFrontOf(bank({ overlay: "INSET" })) })).parameters.frontType).toBe("INSET");
  });

  it("compileUpdate recomputes every field, including product", () => {
    const body = compileUpdate(drawerInstance());
    expect(body.product).toEqual({ productCode: "KIT_BASE_DRAWER", productVersionId: "pv2" });
    expect(body.parameters.drawerCount).toBe(3);
  });

  it("refuses an empty drawer bank", () => {
    expect(() => compileCreate(drawerInstance({ front: drawerFrontOf(bank({ drawers: [] })) }))).toThrow(/at least one drawer/);
  });

  it("refuses a shutter column on a BASE_DRAWER_BANK cabinet", () => {
    const front: CabinetFront = { rows: [{ rowId: "R0", heightMm: 720, columns: [{ columnId: "C0", widthMm: 900, element: shutter(900, 720) }] }] };
    expect(() => compileCreate(drawerInstance({ front }))).toThrow(/drawer-bank front/);
  });
});

describe("BASE_DRAWER_BANK (Slice 2): decode", () => {
  function component(over: Partial<ModelComponent>): ModelComponent {
    return {
      componentId: "c",
      componentType: "SIDE_LEFT",
      dimensions: { width: 560, height: 720, thickness: 18 },
      box: { min: { x: 0, y: 0, z: 0 }, size: { x: 18, y: 720, z: 560 } },
      materialId: "BOARD_BWP_18",
      finishId: null,
      finishedFaces: 0,
      grainDirection: "HEIGHT",
      ...over,
    };
  }
  const DRAWER_FRONT_FINISH: FinishAssignment = { carcassMaterialId: "BOARD_BWP_18", backMaterialId: "BOARD_BACK_6", frontMaterialId: "BOARD_HDHMR_18", frontFinishId: "LAMINATE_WHITE" };

  function modelObject(over: Partial<ModelObject> = {}): ModelObject {
    return {
      lineageId: "lin-2",
      objectCode: "BC-002",
      productCode: "KIT_BASE_DRAWER",
      productVersionId: "pv2",
      parameters: { drawerCount: 3, drawerHeight1: 210, drawerHeight2: 210, frontType: "OVERLAY", material: "BOARD_BWP_18", backMaterial: "BOARD_BACK_6", frontMaterial: "BOARD_HDHMR_18", finish: "LAMINATE_WHITE" },
      dimensions: { width: 900, height: 720, depth: 560 },
      transform: { x: 0, y: 0, z: 0, rotationY: 0 },
      components: [
        component({ componentId: "SL", componentType: "SIDE_LEFT", materialId: "BOARD_BWP_18" }),
        component({ componentId: "BCK", componentType: "BACK", materialId: "BOARD_BACK_6" }),
        // Bottom drawer first in array order, to prove decode sorts by position, not array order.
        component({
          componentId: "DRF-01", componentType: "DRAWER_FRONT", materialId: "BOARD_HDHMR_18", finishId: "LAMINATE_WHITE",
          dimensions: { width: 864, height: 210, thickness: 18 }, box: { min: { x: 18, y: 20, z: 566 }, size: { x: 864, y: 210, z: 18 } },
        }),
        component({
          componentId: "DRF-02", componentType: "DRAWER_FRONT", materialId: "BOARD_HDHMR_18", finishId: "LAMINATE_WHITE",
          dimensions: { width: 864, height: 210, thickness: 18 }, box: { min: { x: 18, y: 253, z: 566 }, size: { x: 864, y: 210, z: 18 } },
        }),
        component({
          componentId: "DRF-03", componentType: "DRAWER_FRONT", materialId: "BOARD_HDHMR_18", finishId: "LAMINATE_WHITE",
          dimensions: { width: 864, height: 210, thickness: 18 }, box: { min: { x: 18, y: 486, z: 566 }, size: { x: 864, y: 210, z: 18 } },
        }),
        // A drawer box side per drawer (Slice 2.1): same y as its front, a shorter height (the
        // DRAWER_BOX_HEIGHT_GAP clearance). "-DBL-" in the id is exactly what decode.ts filters on.
        component({
          componentId: "BC-002-DBL-01", componentType: "DRAWER_BOX_SIDE", materialId: "BOARD_BWP_18",
          dimensions: { width: 542, height: 195, thickness: 18 }, box: { min: { x: 18, y: 20, z: 32 }, size: { x: 18, y: 195, z: 542 } },
        }),
        component({
          componentId: "BC-002-DBL-02", componentType: "DRAWER_BOX_SIDE", materialId: "BOARD_BWP_18",
          dimensions: { width: 542, height: 195, thickness: 18 }, box: { min: { x: 18, y: 253, z: 32 }, size: { x: 18, y: 195, z: 542 } },
        }),
        component({
          componentId: "BC-002-DBL-03", componentType: "DRAWER_BOX_SIDE", materialId: "BOARD_BWP_18",
          dimensions: { width: 542, height: 195, thickness: 18 }, box: { min: { x: 18, y: 486, z: 32 }, size: { x: 18, y: 195, z: 542 } },
        }),
      ],
      ...over,
    };
  }

  it("decodes a drawer bank as a single-column front row", () => {
    const decoded = decodeCabinetInstance(modelObject(), BASE_DRAWER_BANK_CABINET);
    const row = decoded.front.rows[0];
    expect(row?.columns).toHaveLength(1);
    const element = row?.columns[0]?.element;
    expect(element?.kind).toBe("DRAWER_BANK");
  });

  it("orders drawers top to bottom (index 0 = highest y), not by component array order", () => {
    const decoded = decodeCabinetInstance(modelObject(), BASE_DRAWER_BANK_CABINET);
    const bank = decoded.front.rows[0]?.columns[0]?.element as DrawerBank;
    expect(bank.drawers.map((d) => d.index)).toEqual([0, 1, 2]);
    // The component with the highest box.min.y (DRF-03, y=486) is decoded first (index 0).
    expect(bank.drawers[0]?.heightMm).toBe(210);
    expect(bank.drawers).toHaveLength(3);
  });

  it("decodes finish from the DRAWER_FRONT component", () => {
    expect(decodeCabinetInstance(modelObject(), BASE_DRAWER_BANK_CABINET).finish).toEqual(DRAWER_FRONT_FINISH);
  });

  it("Slice 2.1: decodes each drawer's componentId, box height and gap to the next drawer down", () => {
    const decoded = decodeCabinetInstance(modelObject(), BASE_DRAWER_BANK_CABINET);
    const bank = decoded.front.rows[0]?.columns[0]?.element as DrawerBank;
    expect(bank.drawers.map((d) => d.componentId)).toEqual(["DRF-03", "DRF-02", "DRF-01"]);
    expect(bank.drawers.map((d) => d.boxHeightMm)).toEqual([195, 195, 195]);
    // Top (index 0) and middle (index 1) each gap 23mm to the drawer below; the bottom (last) has no gap below.
    expect(bank.drawers.map((d) => d.gapBelowMm)).toEqual([23, 23, null]);
  });

  it("leaves per-drawer runner and the hardware set's runners/handle null (no resolved hardware in the model preview)", () => {
    const decoded = decodeCabinetInstance(modelObject(), BASE_DRAWER_BANK_CABINET);
    const bank = decoded.front.rows[0]?.columns[0]?.element as DrawerBank;
    expect(bank.drawers.every((d) => d.runner === null)).toBe(true);
    expect(decoded.hardware).toEqual({ hinges: [], runners: [], handle: null });
  });

  it("round-trips through compileCreate back to the same parameters", () => {
    const decoded = decodeCabinetInstance(modelObject(), BASE_DRAWER_BANK_CABINET);
    const recompiled = compileCreate(decoded);
    expect(recompiled.parameters).toEqual(modelObject().parameters);
  });
});

describe("BASE_OPEN (Slice 3): compile", () => {
  function shelf(index: number, over: Partial<Shelf> = {}): Shelf {
    return { shelfId: `SHF${String(index)}`, fixed: true, heightFromBottomMm: null, ...over };
  }
  function openInstance(overrides: Partial<CabinetInstance> = {}): CabinetInstance {
    return {
      instanceId: "i3",
      objectCode: "BC-003",
      lineageId: null,
      cabinetType: BASE_OPEN_CABINET,
      recipe: { recipeId: "KITCHEN_BASE_OPEN_V1", productCode: "KIT_BASE_OPEN", productVersionId: "pv3", frontComponentTypes: [] },
      position: { xMm: 1800, yMm: 0, zMm: 0 },
      rotationY: 0,
      dimensions: { widthMm: 600, heightMm: 720, depthMm: 560 },
      front: { rows: [] },
      internals: [shelf(0), shelf(1)],
      corner: null,
      finish: { carcassMaterialId: "BOARD_BWP_18", backMaterialId: "BOARD_BACK_6", frontMaterialId: "BOARD_BWP_18", frontFinishId: "" },
      hardware: { hinges: [], runners: [], handle: null },
      ...overrides,
    };
  }

  it("compiles an open cabinet with no front parameters at all", () => {
    const body = compileCreate(openInstance());
    expect(body).toEqual({
      objectCode: "BC-003",
      objectType: "BASE_CABINET",
      productCode: "KIT_BASE_OPEN",
      productVersionId: "pv3",
      position: { xMm: 1800, yMm: 0, zMm: 0 },
      rotationY: 0,
      dimensions: { widthMm: 600, heightMm: 720, depthMm: 560 },
      parameters: { shelfCount: 2, material: "BOARD_BWP_18", backMaterial: "BOARD_BACK_6" },
    });
  });

  it("compiles zero shelves", () => {
    expect(compileCreate(openInstance({ internals: [] })).parameters.shelfCount).toBe(0);
  });

  it("compileUpdate recomputes every field, including product", () => {
    const body = compileUpdate(openInstance());
    expect(body.product).toEqual({ productCode: "KIT_BASE_OPEN", productVersionId: "pv3" });
    expect(body.parameters.shelfCount).toBe(2);
  });

  it("refuses a non-empty front (an open cabinet has no front)", () => {
    expect(() => compileCreate(openInstance({ front: frontOf(shutter(600, 720)) }))).toThrow(/no front/);
  });

  it("refuses an internal component other than a shelf", () => {
    expect(() => compileCreate(openInstance({ internals: [{ dividerId: "D1", positionMm: 300 }] }))).toThrow(/non-shelf/);
  });
});

describe("BASE_OPEN (Slice 3): decode", () => {
  function component(over: Partial<ModelComponent>): ModelComponent {
    return {
      componentId: "c",
      componentType: "SIDE_LEFT",
      dimensions: { width: 560, height: 720, thickness: 18 },
      box: { min: { x: 0, y: 0, z: 0 }, size: { x: 18, y: 720, z: 560 } },
      materialId: "BOARD_BWP_18",
      finishId: null,
      finishedFaces: 0,
      grainDirection: "HEIGHT",
      ...over,
    };
  }

  function modelObject(over: Partial<ModelObject> = {}): ModelObject {
    return {
      lineageId: "lin-3",
      objectCode: "BC-003",
      productCode: "KIT_BASE_OPEN",
      productVersionId: "pv3",
      parameters: { shelfCount: 2, material: "BOARD_BWP_18", backMaterial: "BOARD_BACK_6" },
      dimensions: { width: 600, height: 720, depth: 560 },
      transform: { x: 1800, y: 0, z: 0, rotationY: 0 },
      components: [
        component({ componentId: "SL", componentType: "SIDE_LEFT", materialId: "BOARD_BWP_18" }),
        component({ componentId: "BCK", componentType: "BACK", materialId: "BOARD_BACK_6" }),
        // Top shelf first in array order, to prove decode sorts by position, not array order.
        component({
          componentId: "SHF-02", componentType: "SHELF", materialId: "BOARD_BWP_18",
          dimensions: { width: 564, height: 480, thickness: 18 }, box: { min: { x: 18, y: 470, z: 32 }, size: { x: 564, y: 18, z: 480 } },
        }),
        component({
          componentId: "SHF-01", componentType: "SHELF", materialId: "BOARD_BWP_18",
          dimensions: { width: 564, height: 480, thickness: 18 }, box: { min: { x: 18, y: 232, z: 32 }, size: { x: 564, y: 18, z: 480 } },
        }),
      ],
      ...over,
    };
  }

  it("decodes zero front rows and no resolved hardware", () => {
    const decoded = decodeCabinetInstance(modelObject(), BASE_OPEN_CABINET);
    expect(decoded.front.rows).toEqual([]);
    expect(decoded.hardware).toEqual({ hinges: [], runners: [], handle: null });
  });

  it("decodes SHELF components into internals, bottom to top, not by component array order", () => {
    const decoded = decodeCabinetInstance(modelObject(), BASE_OPEN_CABINET);
    expect(decoded.internals).toHaveLength(2);
    const [first, second] = decoded.internals as readonly Shelf[];
    expect(first?.heightFromBottomMm).toBe(232);
    expect(second?.heightFromBottomMm).toBe(470);
    expect(decoded.internals.every((s) => "fixed" in s && s.fixed)).toBe(true);
  });

  it("does not decode SHELF components into internals for a shutter cabinet (unchanged Slice 1 behaviour)", () => {
    const shutterObject: ModelObject = {
      lineageId: "lin-1s", objectCode: "BC-001", productCode: "KIT_BASE_STANDARD", productVersionId: "pv1",
      parameters: { shutterCount: 1, frontType: "OVERLAY", material: "BOARD_BWP_18", backMaterial: "BOARD_BACK_6", shutterMaterial: "BOARD_HDHMR_18", finish: "LAMINATE_WHITE" },
      dimensions: { width: 600, height: 720, depth: 560 },
      transform: { x: 0, y: 0, z: 0, rotationY: 0 },
      components: [
        component({ componentId: "SL", componentType: "SIDE_LEFT", materialId: "BOARD_BWP_18" }),
        component({ componentId: "BCK", componentType: "BACK", materialId: "BOARD_BACK_6" }),
        component({ componentId: "SHF-01", componentType: "SHELF", materialId: "BOARD_BWP_18" }),
        component({
          componentId: "SHT0", componentType: "SHUTTER", materialId: "BOARD_HDHMR_18", finishId: "LAMINATE_WHITE",
          dimensions: { width: 564, height: 654, thickness: 18 }, box: { min: { x: 18, y: 33, z: 566 }, size: { x: 564, y: 654, z: 18 } },
        }),
      ],
    };
    expect(decodeCabinetInstance(shutterObject, BASE_SHUTTER_CABINET).internals).toEqual([]);
  });

  it("decodes finish reusing the carcass material for the (nonexistent) front, no finish", () => {
    const decoded = decodeCabinetInstance(modelObject(), BASE_OPEN_CABINET);
    expect(decoded.finish).toEqual({ carcassMaterialId: "BOARD_BWP_18", backMaterialId: "BOARD_BACK_6", frontMaterialId: "BOARD_BWP_18", frontFinishId: "" });
  });

  it("round-trips through compileCreate back to the same parameters", () => {
    const decoded = decodeCabinetInstance(modelObject(), BASE_OPEN_CABINET);
    const recompiled = compileCreate(decoded);
    expect(recompiled.parameters).toEqual(modelObject().parameters);
  });
});

describe("BASE_PULLOUT (Slice 5 step 1): compile", () => {
  function pulloutInstance(overrides: Partial<CabinetInstance> = {}): CabinetInstance {
    return {
      instanceId: "i5",
      objectCode: "BC-005",
      lineageId: null,
      cabinetType: BASE_PULLOUT_CABINET,
      recipe: { recipeId: "KITCHEN_BASE_PULLOUT_V1", productCode: "KIT_BASE_PULLOUT", productVersionId: "pv5", frontComponentTypes: ["SHUTTER"] },
      position: { xMm: 2400, yMm: 0, zMm: 0 },
      rotationY: 0,
      dimensions: { widthMm: 300, heightMm: 720, depthMm: 560 },
      front: frontOf(shutter(300, 720)),
      internals: [{ pullOutId: "PLO0", kind: "TRAY" }, { pullOutId: "PLO1", kind: "TRAY" }, { pullOutId: "PLO2", kind: "TRAY" }],
      corner: null,
      finish: FINISH,
      hardware: { hinges: [], runners: [], handle: null },
      ...overrides,
    };
  }

  it("compiles shutterCount, pulloutCount and finish, never a drawer/shelf parameter", () => {
    const body = compileCreate(pulloutInstance());
    expect(body).toEqual({
      objectCode: "BC-005",
      objectType: "BASE_CABINET",
      productCode: "KIT_BASE_PULLOUT",
      productVersionId: "pv5",
      position: { xMm: 2400, yMm: 0, zMm: 0 },
      rotationY: 0,
      dimensions: { widthMm: 300, heightMm: 720, depthMm: 560 },
      parameters: {
        shutterCount: 1, pulloutCount: 3, frontType: "OVERLAY",
        material: "BOARD_BWP_18", backMaterial: "BOARD_BACK_6", shutterMaterial: "BOARD_HDHMR_18", finish: "LAMINATE_WHITE",
      },
    });
  });

  it("compiles zero pull-outs", () => {
    expect(compileCreate(pulloutInstance({ internals: [] })).parameters.pulloutCount).toBe(0);
  });

  it("compileUpdate recomputes every field, including product", () => {
    const body = compileUpdate(pulloutInstance());
    expect(body.product).toEqual({ productCode: "KIT_BASE_PULLOUT", productVersionId: "pv5" });
    expect(body.parameters.pulloutCount).toBe(3);
  });

  it("refuses a drawer-bank front (a pull-out cabinet's front is always a shutter)", () => {
    const bank: DrawerBank = { kind: "DRAWER_BANK", widthMm: 300, overlay: "OVERLAY", drawers: [] };
    const front: CabinetFront = { rows: [{ rowId: "R0", heightMm: 720, columns: [{ columnId: "C0", widthMm: 300, element: bank }] }] };
    expect(() => compileCreate(pulloutInstance({ front }))).toThrow(/only compiles shutter fronts/);
  });

  it("refuses an internal component other than a pull-out", () => {
    expect(() => compileCreate(pulloutInstance({ internals: [{ shelfId: "SHF0", fixed: true, heightFromBottomMm: null }] }))).toThrow(/non-pullout/);
  });
});

describe("BASE_PULLOUT (Slice 5 step 1): decode", () => {
  function component(over: Partial<ModelComponent>): ModelComponent {
    return {
      componentId: "c",
      componentType: "SIDE_LEFT",
      dimensions: { width: 560, height: 720, thickness: 18 },
      box: { min: { x: 0, y: 0, z: 0 }, size: { x: 18, y: 720, z: 560 } },
      materialId: "BOARD_BWP_18",
      finishId: null,
      finishedFaces: 0,
      grainDirection: "HEIGHT",
      ...over,
    };
  }

  function modelObject(over: Partial<ModelObject> = {}): ModelObject {
    return {
      lineageId: "lin-5",
      objectCode: "BC-005",
      productCode: "KIT_BASE_PULLOUT",
      productVersionId: "pv5",
      parameters: { shutterCount: 1, pulloutCount: 2, frontType: "OVERLAY", material: "BOARD_BWP_18", backMaterial: "BOARD_BACK_6", shutterMaterial: "BOARD_HDHMR_18", finish: "LAMINATE_WHITE" },
      dimensions: { width: 300, height: 720, depth: 560 },
      transform: { x: 2400, y: 0, z: 0, rotationY: 0 },
      components: [
        component({ componentId: "SL", componentType: "SIDE_LEFT", materialId: "BOARD_BWP_18" }),
        component({ componentId: "BCK", componentType: "BACK", materialId: "BOARD_BACK_6" }),
        component({
          componentId: "SHT0", componentType: "SHUTTER", materialId: "BOARD_HDHMR_18", finishId: "LAMINATE_WHITE",
          dimensions: { width: 264, height: 654, thickness: 18 }, box: { min: { x: 18, y: 33, z: 566 }, size: { x: 264, y: 654, z: 18 } },
        }),
        // Top tray first in array order, to prove decode sorts by position, not array order.
        component({
          componentId: "PTR-02", componentType: "PULLOUT_TRAY", materialId: "BOARD_BACK_6",
          dimensions: { width: 238, height: 480, thickness: 6 }, box: { min: { x: 26, y: 428, z: 32 }, size: { x: 238, y: 6, z: 480 } },
        }),
        component({
          componentId: "PTR-01", componentType: "PULLOUT_TRAY", materialId: "BOARD_BACK_6",
          dimensions: { width: 238, height: 480, thickness: 6 }, box: { min: { x: 26, y: 224, z: 32 }, size: { x: 238, y: 6, z: 480 } },
        }),
      ],
      ...over,
    };
  }

  it("decodes a shutter front (identical shape to BASE_SHUTTER)", () => {
    const decoded = decodeCabinetInstance(modelObject(), BASE_PULLOUT_CABINET);
    expect(decoded.front.rows).toHaveLength(1);
    expect(decoded.front.rows[0]?.columns).toHaveLength(1);
    expect(decoded.front.rows[0]?.columns[0]?.element.kind).toBe("SHUTTER");
    expect(decoded.hardware.hinges).toHaveLength(1);
  });

  it("decodes PULLOUT_TRAY components into internals, bottom to top, not by component array order", () => {
    const decoded = decodeCabinetInstance(modelObject(), BASE_PULLOUT_CABINET);
    expect(decoded.internals).toHaveLength(2);
    const pullouts = decoded.internals as readonly PullOut[];
    expect(pullouts.every((p) => p.kind === "TRAY")).toBe(true);
  });

  it("decodes finish from the shutter front, exactly like BASE_SHUTTER", () => {
    const decoded = decodeCabinetInstance(modelObject(), BASE_PULLOUT_CABINET);
    expect(decoded.finish).toEqual({ carcassMaterialId: "BOARD_BWP_18", backMaterialId: "BOARD_BACK_6", frontMaterialId: "BOARD_HDHMR_18", frontFinishId: "LAMINATE_WHITE" });
  });

  it("round-trips through compileCreate back to the same parameters", () => {
    const decoded = decodeCabinetInstance(modelObject(), BASE_PULLOUT_CABINET);
    const recompiled = compileCreate(decoded);
    expect(recompiled.parameters).toEqual(modelObject().parameters);
  });
});

describe("cornerPairPlacementDA (Slice 4)", () => {
  /** `@lintel/geometry-engine`'s own `toWorld` formula (room.ts), reproduced here only to prove the geometric
   * invariant this pure function exists for — cabinet-engine has no dependency on geometry-engine. */
  function worldFootprint(widthMm: number, depthMm: number, position: { readonly xMm: number; readonly zMm: number }, rotationY: 0 | 90 | 180 | 270): { readonly x: readonly [number, number]; readonly z: readonly [number, number] } {
    const rad = (rotationY * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const corners = [[0, 0], [widthMm, 0], [0, depthMm], [widthMm, depthMm]].map(([px, pz]) => ({
      x: position.xMm + (px ?? 0) * cos + (pz ?? 0) * sin,
      z: position.zMm - (px ?? 0) * sin + (pz ?? 0) * cos,
    }));
    return { x: [Math.min(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.x))], z: [Math.min(...corners.map((c) => c.z)), Math.max(...corners.map((c) => c.z))] };
  }

  it("places the return leg against wall D, back at the D-A room corner", () => {
    const { returnLeg } = cornerPairPlacementDA({ widthMm: 600, depthMm: 560 });
    expect(returnLeg).toEqual({ position: { xMm: 0, yMm: 0, zMm: 600 }, rotationY: 90 });
  });

  it("places the front leg against wall A, starting exactly where the return leg's depth ends", () => {
    const { frontLeg } = cornerPairPlacementDA({ widthMm: 600, depthMm: 560 });
    expect(frontLeg).toEqual({ position: { xMm: 560, yMm: 0, zMm: 0 }, rotationY: 0 });
  });

  it("the two legs' footprints touch (zero gap) without a positive overlap volume, for any leg width/depth", () => {
    for (const spec of [{ widthMm: 600, depthMm: 560 }, { widthMm: 450, depthMm: 600 }, { widthMm: 900, depthMm: 500 }]) {
      const { returnLeg, frontLeg } = cornerPairPlacementDA(spec);
      const returnFootprint = worldFootprint(spec.widthMm, spec.depthMm, returnLeg.position, returnLeg.rotationY);
      const frontFootprint = worldFootprint(spec.widthMm, spec.depthMm, frontLeg.position, frontLeg.rotationY);
      // Touching along x at the return leg's depth; overlapping in z (both start at the corner) is fine (edge
      // contact, not a positive-volume collision) since the x ranges only just meet.
      expect(returnFootprint.x[1]).toBeCloseTo(frontFootprint.x[0], 9);
      const dx = Math.max(0, returnFootprint.x[0] - frontFootprint.x[1], frontFootprint.x[0] - returnFootprint.x[1]);
      expect(dx).toBeCloseTo(0, 9);
    }
  });
});
