/**
 * Design Studio — Slice 1 decoder: the reverse of `compile.ts`. Builds a `CabinetInstance` from the API's
 * already-resolved model (`GET /api/v1/design-versions/{versionId}/model`, one entry of `objects[]`), so the
 * Design Studio always displays the same shape it edits — never a second, independently-computed geometry.
 * Slice 1 decodes only `SHUTTER` front components and the carcass/back/front material and finish they and the
 * carcass components already carry; a later slice's decoder adds drawers, internals and corner geometry as
 * those component types start appearing in the response.
 */
import type { CabinetFront, CabinetInstance, CabinetType, FinishAssignment, FrontColumn, FrontRow, HardwareSet, HingeConfiguration, Shutter } from "./model.js";

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

function hingeConfigurationOf(overlay: "OVERLAY" | "INSET"): HingeConfiguration {
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
function decodeShutterFront(object: ModelObject): { readonly front: CabinetFront; readonly hinges: readonly HingeConfiguration[] } {
  const overlay: "OVERLAY" | "INSET" = object.parameters.frontType === "INSET" ? "INSET" : "OVERLAY";
  const shutterComponents = object.components.filter((c) => c.componentType === "SHUTTER").slice().sort((a, b) => a.box.min.x - b.box.min.x);
  if (shutterComponents.length === 0) return { front: { rows: [] }, hinges: [] };
  const columns: FrontColumn[] = shutterComponents.map((c, i) => {
    const shutter: Shutter = { kind: "SHUTTER", widthMm: c.dimensions.width, heightMm: c.dimensions.height, overlay, hinge: hingeConfigurationOf(overlay) };
    return { columnId: `C${String(i)}`, widthMm: c.dimensions.width, element: shutter };
  });
  const row: FrontRow = { rowId: "R0", heightMm: object.dimensions.height, columns };
  return { front: { rows: [row] }, hinges: columns.map((c) => (c.element as Shutter).hinge) };
}

/** Reads material/finish ids off the resolved components — never invented: carcass from a side, back from the back panel, front from a shutter. */
function decodeFinish(object: ModelObject): FinishAssignment {
  const side = requireComponent(object, "SIDE_LEFT");
  const back = requireComponent(object, "BACK");
  const shutter = requireComponent(object, "SHUTTER");
  return {
    carcassMaterialId: side.materialId,
    backMaterialId: back.materialId,
    frontMaterialId: shutter.materialId,
    frontFinishId: shutter.finishId ?? "",
  };
}

/** Decodes one API model object into the typed `CabinetInstance` the Design Studio edits and displays. `cabinetType` comes from `library.ts` (`findAvailableCabinetType(object.productCode)`). */
export function decodeCabinetInstance(object: ModelObject, cabinetType: CabinetType): CabinetInstance {
  const { front, hinges } = decodeShutterFront(object);
  const hardware: HardwareSet = { hinges, runners: [], handle: null };
  return {
    instanceId: object.lineageId,
    objectCode: object.objectCode,
    lineageId: object.lineageId,
    cabinetType,
    recipe: { recipeId: cabinetType.recipeId, productCode: object.productCode, productVersionId: object.productVersionId, frontComponentTypes: ["SHUTTER"] },
    position: { xMm: object.transform.x, yMm: object.transform.y, zMm: object.transform.z },
    rotationY: rotationYOf(object.transform.rotationY),
    dimensions: { widthMm: object.dimensions.width, heightMm: object.dimensions.height, depthMm: object.dimensions.depth },
    front,
    internals: [],
    corner: null,
    finish: decodeFinish(object),
    hardware,
  };
}
