/**
 * Design Studio compiler: maps a `CabinetInstance` to the exact request bodies the existing object endpoints
 * already accept — `POST /api/v1/design-versions/{versionId}/objects` (`ObjectInput`) and
 * `PATCH /api/v1/design-objects/{objectId}` (`ObjectUpdate`), `apps/api/.../design-versions.schemas.ts`. No
 * engine, persistence or API change: every supported cabinet type compiles to parameters its own recipe
 * already resolves — `width`/`height`/`depth` always via `dimensions` (never `parameters`: the engine rejects
 * a dimension key duplicated there).
 *
 * Slice 1 (`BASE_SHUTTER` / `KIT_BASE_STANDARD`): `shutterCount`, `frontType`, `material`, `backMaterial`,
 * `shutterMaterial`, `finish`. Carcass/back board thickness and shelf count are left at the recipe's own
 * defaults: Slice 1 has no control for them.
 *
 * Slice 2 (`BASE_DRAWER_BANK` / `KIT_BASE_DRAWER`): `drawerCount`, `frontType`, `material`, `backMaterial`,
 * `frontMaterial`, `finish`.
 *
 * Refuses (throws) a `CabinetInstance` outside a supported product's scope rather than silently dropping
 * data: an unknown `productCode`, a mismatched front element, more than one front row, any `internals`, or a
 * `corner` configuration.
 */
import type { CabinetInstance, DrawerBank, OverlayMode, Shutter } from "./model.js";

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
  if (instance.corner !== null) throw new Error("Cannot compile a corner cabinet (reserved for Slice 4)");
  if (instance.internals.length > 0) throw new Error("Cannot compile internal components (reserved for Slice 3)");
  if (instance.front.rows.length !== 1) throw new Error("Only a front with exactly one row can be compiled (multi-row fronts are reserved for a later slice)");
  const [row] = instance.front.rows;
  if (row === undefined || row.columns.length === 0) throw new Error("A cabinet front row must have at least one column");
  return row.columns.map((column) => {
    if (column.element.kind !== "SHUTTER") throw new Error(`A BASE_SHUTTER cabinet only compiles shutter fronts; column '${column.columnId}' is a ${column.element.kind}`);
    return column.element;
  });
}

function shutterFrontTypeOf(shutters: readonly Shutter[]): OverlayMode {
  const [first, ...rest] = shutters;
  if (first === undefined) throw new Error("A cabinet front row must have at least one column");
  if (rest.some((s) => s.overlay !== first.overlay)) throw new Error("Every shutter on one cabinet must share a single overlay mode");
  return first.overlay;
}

function drawerBankOf(instance: CabinetInstance): DrawerBank {
  if (instance.corner !== null) throw new Error("Cannot compile a corner cabinet (reserved for Slice 4)");
  if (instance.internals.length > 0) throw new Error("Cannot compile internal components (reserved for Slice 3)");
  if (instance.front.rows.length !== 1) throw new Error("Only a front with exactly one row can be compiled (multi-row fronts are reserved for a later slice)");
  const [row] = instance.front.rows;
  if (row === undefined || row.columns.length !== 1) throw new Error("A drawer bank front must have exactly one column");
  const [column] = row.columns;
  if (column === undefined || column.element.kind !== "DRAWER_BANK") throw new Error(`A BASE_DRAWER_BANK cabinet only compiles a drawer-bank front; column is a ${column?.element.kind}`);
  if (column.element.drawers.length === 0) throw new Error("A drawer bank must have at least one drawer");
  return column.element;
}

function shutterParametersOf(instance: CabinetInstance): CompiledParameters {
  const shutters = shuttersOf(instance);
  return {
    shutterCount: shutters.length,
    frontType: shutterFrontTypeOf(shutters),
    material: instance.finish.carcassMaterialId,
    backMaterial: instance.finish.backMaterialId,
    shutterMaterial: instance.finish.frontMaterialId,
    finish: instance.finish.frontFinishId,
  };
}

function drawerParametersOf(instance: CabinetInstance): CompiledParameters {
  const bank = drawerBankOf(instance);
  return {
    drawerCount: bank.drawers.length,
    frontType: bank.overlay,
    material: instance.finish.carcassMaterialId,
    backMaterial: instance.finish.backMaterialId,
    frontMaterial: instance.finish.frontMaterialId,
    finish: instance.finish.frontFinishId,
  };
}

/** Every parameter key belongs to exactly one product; compiling any other productCode is refused, not guessed. */
function parametersOf(instance: CabinetInstance): CompiledParameters {
  switch (instance.recipe.productCode) {
    case "KIT_BASE_STANDARD": return shutterParametersOf(instance);
    case "KIT_BASE_DRAWER": return drawerParametersOf(instance);
    default: throw new Error(`No compiler for product '${instance.recipe.productCode}'`);
  }
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
