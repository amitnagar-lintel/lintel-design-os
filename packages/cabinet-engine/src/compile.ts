/**
 * Design Studio — Slice 1 compiler: maps a `CabinetInstance` to the exact request bodies the existing object
 * endpoints already accept — `POST /api/v1/design-versions/{versionId}/objects` (`ObjectInput`) and
 * `PATCH /api/v1/design-objects/{objectId}` (`ObjectUpdate`), `apps/api/.../design-versions.schemas.ts`. No
 * engine, persistence or API change: Slice 1's only cabinet type, `BASE_SHUTTER`, compiles to the exact
 * `KIT_BASE_STANDARD` parameters `KITCHEN_BASE_STANDARD_V1` already resolves — `width`/`height`/`depth` via
 * `dimensions` (never `parameters`: the engine rejects a dimension key duplicated there), `shutterCount`,
 * `frontType`, `material`, `backMaterial`, `shutterMaterial` and `finish` via `parameters`. Carcass/back board
 * thickness and shelf count are left at the recipe's own defaults: Slice 1 has no control for them.
 *
 * Refuses (throws) a `CabinetInstance` outside Slice 1's scope rather than silently dropping data: a
 * `DrawerBank` column, more than one front row, any `internals`, or a `corner` configuration.
 */
import type { CabinetInstance, OverlayMode, Shutter } from "./model.js";

export interface CompiledPosition {
  readonly xMm: number;
  readonly yMm: number;
  readonly zMm: number;
}

export interface CompiledDimensions {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly depthMm: number;
}

export type CompiledParameters = Readonly<Record<string, number | string>>;

/** The exact `body` shape `POST /api/v1/design-versions/{versionId}/objects` accepts. */
export interface CompiledObjectInput {
  readonly objectCode: string;
  readonly objectType: "BASE_CABINET";
  readonly productCode: string;
  readonly productVersionId: string;
  readonly position: CompiledPosition;
  readonly rotationY: 0 | 90 | 180 | 270;
  readonly dimensions: CompiledDimensions;
  readonly parameters: CompiledParameters;
}

/** The exact `body` shape `PATCH /api/v1/design-objects/{objectId}` accepts; every field is recomputed. */
export interface CompiledObjectUpdate {
  readonly product: { readonly productCode: string; readonly productVersionId: string };
  readonly position: CompiledPosition;
  readonly rotationY: 0 | 90 | 180 | 270;
  readonly dimensions: CompiledDimensions;
  readonly parameters: CompiledParameters;
}

function shuttersOf(instance: CabinetInstance): readonly Shutter[] {
  if (instance.corner !== null) throw new Error("Slice 1 cannot compile a corner cabinet (reserved for Slice 4)");
  if (instance.internals.length > 0) throw new Error("Slice 1 cannot compile internal components (reserved for Slice 3)");
  if (instance.front.rows.length !== 1) throw new Error("Slice 1 only compiles a front with exactly one row (multi-row fronts are reserved for Slice 2)");
  const [row] = instance.front.rows;
  if (row === undefined || row.columns.length === 0) throw new Error("A cabinet front row must have at least one column");
  return row.columns.map((column) => {
    if (column.element.kind !== "SHUTTER") throw new Error(`Slice 1 only compiles shutter fronts; column '${column.columnId}' is a ${column.element.kind} (reserved for Slice 2)`);
    return column.element;
  });
}

function frontTypeOf(shutters: readonly Shutter[]): OverlayMode {
  const [first, ...rest] = shutters;
  if (first === undefined) throw new Error("A cabinet front row must have at least one column");
  if (rest.some((s) => s.overlay !== first.overlay)) throw new Error("Slice 1 requires every shutter on one cabinet to share a single overlay mode");
  return first.overlay;
}

function parametersOf(instance: CabinetInstance): CompiledParameters {
  const shutters = shuttersOf(instance);
  return {
    shutterCount: shutters.length,
    frontType: frontTypeOf(shutters),
    material: instance.finish.carcassMaterialId,
    backMaterial: instance.finish.backMaterialId,
    shutterMaterial: instance.finish.frontMaterialId,
    finish: instance.finish.frontFinishId,
  };
}

/** A new `CabinetInstance` → the `POST .../objects` body. */
export function compileCreate(instance: CabinetInstance): CompiledObjectInput {
  return {
    objectCode: instance.objectCode,
    objectType: "BASE_CABINET",
    productCode: instance.recipe.productCode,
    productVersionId: instance.recipe.productVersionId,
    position: instance.position,
    rotationY: instance.rotationY,
    dimensions: instance.dimensions,
    parameters: parametersOf(instance),
  };
}

/** An edited `CabinetInstance` → the `PATCH .../design-objects/{id}` body. */
export function compileUpdate(instance: CabinetInstance): CompiledObjectUpdate {
  return {
    product: { productCode: instance.recipe.productCode, productVersionId: instance.recipe.productVersionId },
    position: instance.position,
    rotationY: instance.rotationY,
    dimensions: instance.dimensions,
    parameters: parametersOf(instance),
  };
}
