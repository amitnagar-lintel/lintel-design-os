import { describe, expect, it } from "vitest";
import type { CabinetFront, CabinetInstance, FinishAssignment, OverlayMode, Shutter } from "../src/model.js";
import { BASE_SHUTTER_CABINET, CABINET_LIBRARY, findAvailableCabinetType } from "../src/library.js";
import { compileCreate, compileUpdate } from "../src/compile.js";
import { decodeCabinetInstance, type ModelComponent, type ModelObject } from "../src/decode.js";

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
  it("lists BASE_SHUTTER as the only available cabinet type", () => {
    const available = CABINET_LIBRARY.filter((e) => e.availability.kind === "AVAILABLE");
    expect(available).toHaveLength(1);
    expect(available[0]?.cabinetTypeId).toBe("BASE_SHUTTER");
  });

  it("marks every other entry PLANNED with a slice number", () => {
    for (const entry of CABINET_LIBRARY) {
      if (entry.cabinetTypeId === "BASE_SHUTTER") continue;
      expect(entry.availability.kind).toBe("PLANNED");
      if (entry.availability.kind === "PLANNED") expect(entry.availability.slice).toBeGreaterThan(0);
    }
  });

  it("resolves KIT_BASE_STANDARD to BASE_SHUTTER_CABINET and nothing else", () => {
    expect(findAvailableCabinetType("KIT_BASE_STANDARD")).toBe(BASE_SHUTTER_CABINET);
    expect(findAvailableCabinetType("KIT_WARDROBE")).toBeUndefined();
  });

  it("offers 1- and 2-shutter front topologies", () => {
    expect(BASE_SHUTTER_CABINET.supportedFronts.map((f) => f.topologyId)).toEqual(["BASE_1_SHUTTER", "BASE_2_SHUTTER"]);
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

  it("refuses a drawer bank column", () => {
    const front: CabinetFront = { rows: [{ rowId: "R0", heightMm: 720, columns: [{ columnId: "C0", widthMm: 600, element: { kind: "DRAWER_BANK", widthMm: 600, drawers: [] } }] }] };
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
