/**
 * Design Studio decoder: the reverse of `compile.ts`. Builds a `CabinetInstance` from the API's already-
 * resolved model (`GET /api/v1/design-versions/{versionId}/model`, one entry of `objects[]`), so the Design
 * Studio always displays the same shape it edits — never a second, independently-computed geometry.
 *
 * Slice 1 decodes `SHUTTER` front components; Slice 2 adds `DRAWER_FRONT` (a `DrawerBank`, top drawer first);
 * Slice 3 adds `KIT_BASE_OPEN`'s front-less dispatch (falls out of the existing "no shutter/drawer front
 * components" cases, needing no new front-decoding branch) and decodes its `SHELF` components into
 * `internals`. A later slice's decoder adds corner geometry as those component types start appearing in the
 * response. Per-drawer/-shutter hardware (`Drawer.runner`, `Handle`) stays `null`: the model preview carries
 * no resolved hardware article, only the BOM does.
 */
import type { CabinetFront, CabinetInstance, CabinetType, Drawer, DrawerBank, FinishAssignment, FrontColumn, FrontRow, HardwareSet, HingeConfiguration, OverlayMode, Shelf, Shutter } from "./model.js";

export interface ModelComponent {
  readonly componentId: string;
  readonly componentType: string;
  readonly dimensions: { readonly width: number; readonly height: number; readonly thickness: number };
  readonly box: { readonly min: { readonly x: number; readonly y: number; readonly z: number }; readonly size: { readonly x: number; readonly y: number; readonly z: number } };
  readonly materialId: string;
  readonly finishId: string | null;
  readonly finishedFaces: number;
  readonly grainDirection: string;
}

/** The subset of one `GET .../model` `objects[]` entry the decoder reads. */
export interface ModelObject {
  readonly lineageId: string;
  readonly objectCode: string;
  readonly productCode: string;
  readonly productVersionId: string;
  readonly parameters: Readonly<Record<string, number | string>>;
  readonly dimensions: { readonly width: number; readonly height: number; readonly depth: number };
  readonly transform: { readonly x: number; readonly y: number; readonly z: number; readonly rotationY: number };
  readonly components: readonly ModelComponent[];
}

const ROTATIONS = [0, 90, 180, 270] as const;

function rotationYOf(value: number): 0 | 90 | 180 | 270 {
  const match = ROTATIONS.find((r) => r === value);
  if (match === undefined) throw new Error(`Unsupported rotation ${String(value)}°; only quarter turns are decodable`);
  return match;
}

function overlayOf(object: ModelObject): OverlayMode {
  return object.parameters.frontType === "INSET" ? "INSET" : "OVERLAY";
}

function hingeConfigurationOf(overlay: OverlayMode): HingeConfiguration {
  return { mounting: overlay === "OVERLAY" ? "FULL_OVERLAY" : "INSET", openingAngle: null };
}

function findComponent(object: ModelObject, componentType: string): ModelComponent | undefined {
  return object.components.find((c) => c.componentType === componentType);
}

function requireComponent(object: ModelObject, componentType: string): ModelComponent {
  const component = findComponent(object, componentType);
  if (component === undefined) throw new Error(`Resolved object ${object.objectCode} has no ${componentType} component; cannot decode it`);
  return component;
}

/** Builds `front` and its hinge configurations from the object's `SHUTTER` components, left to right. */
function decodeShutterFront(object: ModelObject): { readonly front: CabinetFront; readonly hardware: HardwareSet } {
  const overlay = overlayOf(object);
  const shutterComponents = object.components.filter((c) => c.componentType === "SHUTTER").slice().sort((a, b) => a.box.min.x - b.box.min.x);
  if (shutterComponents.length === 0) return { front: { rows: [] }, hardware: { hinges: [], runners: [], handle: null } };
  const columns: FrontColumn[] = shutterComponents.map((c, i) => {
    const shutter: Shutter = { kind: "SHUTTER", widthMm: c.dimensions.width, heightMm: c.dimensions.height, overlay, hinge: hingeConfigurationOf(overlay) };
    return { columnId: `C${String(i)}`, widthMm: c.dimensions.width, element: shutter };
  });
  const row: FrontRow = { rowId: "R0", heightMm: object.dimensions.height, columns };
  const hinges = columns.map((c) => (c.element as Shutter).hinge);
  return { front: { rows: [row] }, hardware: { hinges, runners: [], handle: null } };
}

/**
 * Builds `front` from the object's `DRAWER_FRONT` components, top drawer first (index 0). Slice 2.1: also
 * reads `boxHeightMm` from the matching `DRAWER_BOX_SIDE` component (the box's own left side; the right side
 * shares the same position.y by construction, so either would do) and `gapBelowMm` from the vertical gap to
 * the next drawer down — both purely geometric facts read off the already-resolved model, never recomputed.
 */
function decodeDrawerBankFront(object: ModelObject): { readonly front: CabinetFront; readonly hardware: HardwareSet } {
  const overlay = overlayOf(object);
  const frontComponents = object.components.filter((c) => c.componentType === "DRAWER_FRONT").slice().sort((a, b) => b.box.min.y - a.box.min.y);
  if (frontComponents.length === 0) return { front: { rows: [] }, hardware: { hinges: [], runners: [], handle: null } };
  // One drawer box side per drawer: DRAWER_BOX_SIDE_LEFT and _RIGHT share componentType and position.y, so
  // filtering to the left side's own component id ("-DBL-") picks exactly one per drawer.
  const boxSides = object.components.filter((c) => c.componentType === "DRAWER_BOX_SIDE" && c.componentId.includes("-DBL-")).slice().sort((a, b) => b.box.min.y - a.box.min.y);
  const drawers: Drawer[] = frontComponents.map((c, index) => {
    const next = frontComponents[index + 1];
    return {
      kind: "DRAWER",
      widthMm: c.dimensions.width,
      heightMm: c.dimensions.height,
      frontThicknessMm: c.dimensions.thickness,
      index,
      runner: null,
      componentId: c.componentId,
      boxHeightMm: boxSides[index]?.dimensions.height ?? null,
      gapBelowMm: next === undefined ? null : c.box.min.y - (next.box.min.y + next.box.size.y),
    };
  });
  const bank: DrawerBank = { kind: "DRAWER_BANK", widthMm: object.dimensions.width, overlay, drawers };
  const row: FrontRow = { rowId: "R0", heightMm: object.dimensions.height, columns: [{ columnId: "C0", widthMm: bank.widthMm, element: bank }] };
  return { front: { rows: [row] }, hardware: { hinges: [], runners: [], handle: null } };
}

/**
 * Reads material/finish ids off the resolved components — never invented: carcass from a side, back from the
 * back panel, front from whichever front type this recipe produces. A `BASE_OPEN` cabinet has no front
 * component at all: it reuses the carcass material (never applied to any component; see `kit-base-open.ts`)
 * and reports no finish.
 */
function decodeFinish(object: ModelObject): FinishAssignment {
  const side = requireComponent(object, "SIDE_LEFT");
  const back = requireComponent(object, "BACK");
  const front = findComponent(object, "SHUTTER") ?? findComponent(object, "DRAWER_FRONT");
  return {
    carcassMaterialId: side.materialId,
    backMaterialId: back.materialId,
    frontMaterialId: front?.materialId ?? side.materialId,
    frontFinishId: front?.finishId ?? "",
  };
}

/** Which recipe-produced component types this object's front is made of, for `CabinetRecipe.frontComponentTypes`. Empty for `BASE_OPEN` (no front at all). */
function frontComponentTypesOf(object: ModelObject): readonly ("SHUTTER" | "DRAWER_FRONT")[] {
  if (object.components.some((c) => c.componentType === "DRAWER_FRONT")) return ["DRAWER_FRONT"];
  if (object.components.some((c) => c.componentType === "SHUTTER")) return ["SHUTTER"];
  return [];
}

/**
 * Every `SHELF` component, bottom to top (Slice 3, `BASE_OPEN` only — `KITCHEN_BASE_STANDARD_V1` also
 * produces `SHELF` components today, but Slice 1 never exposed a shelf-count control and `compile.ts`'s
 * shutter path still refuses any `internals`; decoding them there too would break a shutter cabinet's own
 * save, since its `shelfCount` would round-trip through a value Slice 1 never intended to carry). Recipe
 * formulas always space shelves evenly, so a decoded shelf is always `fixed: true` — there is no per-shelf
 * position control this slice.
 */
function decodeShelves(object: ModelObject): readonly Shelf[] {
  return object.components
    .filter((c) => c.componentType === "SHELF")
    .slice()
    .sort((a, b) => a.box.min.y - b.box.min.y)
    .map((c, i) => ({ shelfId: `SHF${String(i)}`, fixed: true, heightFromBottomMm: c.box.min.y }));
}

/** Decodes one API model object into the typed `CabinetInstance` the Design Studio edits and displays. `cabinetType` comes from `library.ts` (`findAvailableCabinetType(object.productCode)`). */
export function decodeCabinetInstance(object: ModelObject, cabinetType: CabinetType): CabinetInstance {
  const { front, hardware } = frontComponentTypesOf(object)[0] === "DRAWER_FRONT" ? decodeDrawerBankFront(object) : decodeShutterFront(object);
  return {
    instanceId: object.lineageId,
    objectCode: object.objectCode,
    lineageId: object.lineageId,
    cabinetType,
    recipe: { recipeId: cabinetType.recipeId, productCode: object.productCode, productVersionId: object.productVersionId, frontComponentTypes: frontComponentTypesOf(object) },
    position: { xMm: object.transform.x, yMm: object.transform.y, zMm: object.transform.z },
    rotationY: rotationYOf(object.transform.rotationY),
    dimensions: { widthMm: object.dimensions.width, heightMm: object.dimensions.height, depthMm: object.dimensions.depth },
    front,
    internals: object.productCode === "KIT_BASE_OPEN" ? decodeShelves(object) : [],
    corner: null,
    finish: decodeFinish(object),
    hardware,
  };
}
