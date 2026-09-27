import type {
  ComponentType,
  ConstructionRecipe,
  EdgeBand,
  Finish,
  HardwareCategory,
  HardwareRule,
  HardwareRuleSet,
  HingeMounting,
  Material,
  ProductDefinition,
} from "@lintel/types";
import { engineCalculationStatus } from "../envelope.js";
import { MappingError } from "../errors.js";
import type { MapContext, Versioned, VersionMeta, VersionRow } from "./common.js";
import { checkEngineStatus, omit, readEnvelope, requireLabel, versioned, versionRow } from "./common.js";

/*
 * Catalog domains (Material incl. edge bands, Finish, Hardware, Product/Recipe) are item
 * catalogs, not standards: each item has its own entity + immutable versions with typed
 * technical columns. `null` technical values stay null ("not yet defined").
 */

/* ------------------------------------------------------------ material (boards) */

export interface MaterialVersionRow extends VersionRow {
  readonly category: "BOARD";
  readonly name: string;
  readonly substrate: string | null;
  readonly thickness_mm: number;
  readonly sheet_width_mm: number | null;
  readonly sheet_height_mm: number | null;
  readonly grain: boolean | null;
  readonly density_kg_m3: number | null;
}

export function materialToRow(m: Material, meta: VersionMeta, ctx: MapContext): MaterialVersionRow {
  checkEngineStatus(`material ${m.materialId}`, m.status, meta);
  const content = omit(m, "status");
  return {
    ...versionRow(ctx, m.materialId, meta, m.source, String(meta.versionNumber), content),
    category: m.category,
    name: m.name,
    substrate: m.substrate,
    thickness_mm: m.thickness,
    sheet_width_mm: m.sheetSize?.width ?? null,
    sheet_height_mm: m.sheetSize?.height ?? null,
    grain: m.grain,
    density_kg_m3: m.densityKgPerM3,
  };
}

export const materialFromRow = (r: MaterialVersionRow): Versioned<Material> => versioned(r, materialValue(r));

function materialValue(r: MaterialVersionRow): Material {
  const e = readEnvelope(r);
  if ((r.sheet_width_mm === null) !== (r.sheet_height_mm === null)) throw new MappingError(`material ${r.entity_code}: sheet width and height must both be set or both null`);
  return {
    materialId: r.entity_code,
    category: r.category,
    name: r.name,
    substrate: r.substrate,
    thickness: r.thickness_mm,
    sheetSize: r.sheet_width_mm === null || r.sheet_height_mm === null ? null : { width: r.sheet_width_mm, height: r.sheet_height_mm },
    grain: r.grain,
    densityKgPerM3: r.density_kg_m3,
    status: engineCalculationStatus(e.status),
    source: e.source,
  };
}

/* ------------------------------------------------------------ edge band (material domain) */

export interface EdgeBandVersionRow extends VersionRow {
  readonly name: string;
  readonly material: EdgeBand["material"];
  readonly thickness_mm: number;
  readonly width_mm: number | null;
}

export function edgeBandToRow(b: EdgeBand, meta: VersionMeta, ctx: MapContext): EdgeBandVersionRow {
  checkEngineStatus(`edge band ${b.edgeBandId}`, b.status, meta);
  const content = omit(b, "status");
  return { ...versionRow(ctx, b.edgeBandId, meta, b.source, String(meta.versionNumber), content), name: b.name, material: b.material, thickness_mm: b.thickness, width_mm: b.width };
}

export const edgeBandFromRow = (r: EdgeBandVersionRow): Versioned<EdgeBand> => versioned(r, edgeBandValue(r));

function edgeBandValue(r: EdgeBandVersionRow): EdgeBand {
  const e = readEnvelope(r);
  return { edgeBandId: r.entity_code, name: r.name, material: r.material, thickness: r.thickness_mm, width: r.width_mm, status: engineCalculationStatus(e.status), source: e.source };
}

/* ------------------------------------------------------------ finish */

export interface FinishVersionRow extends VersionRow {
  readonly finish_type: Finish["type"];
  readonly name: string;
  readonly thickness_mm: number | null;
}

export function finishToRow(f: Finish, meta: VersionMeta, ctx: MapContext): FinishVersionRow {
  checkEngineStatus(`finish ${f.finishId}`, f.status, meta);
  const content = omit(f, "status");
  return { ...versionRow(ctx, f.finishId, meta, f.source, String(meta.versionNumber), content), finish_type: f.type, name: f.name, thickness_mm: f.thickness };
}

export const finishFromRow = (r: FinishVersionRow): Versioned<Finish> => versioned(r, finishValue(r));

function finishValue(r: FinishVersionRow): Finish {
  const e = readEnvelope(r);
  return { finishId: r.entity_code, type: r.finish_type, name: r.name, thickness: r.thickness_mm, status: engineCalculationStatus(e.status), source: e.source };
}

/* ------------------------------------------------------------ product and recipe (definitions are data, PRD §14) */

/** Product definition kept as validated jsonb: parameters, rules and the BOQ recipe are data, never code. */
export interface ProductVersionRow extends VersionRow {
  readonly category: ProductDefinition["category"];
  readonly object_type: ProductDefinition["objectType"];
  readonly recipe_code: string;
  /** Exact recipe VERSION this product version is built from (recipes are a dependency of products, not a design pin). */
  readonly recipe_version_id: string;
  readonly definition: Omit<ProductDefinition, "status">;
}

export function productToRow(p: ProductDefinition, meta: VersionMeta, ctx: MapContext & { readonly recipeVersionId: string }, source: string): ProductVersionRow {
  checkEngineStatus(`product ${p.productId}`, p.status, meta);
  const definition = omit(p, "status");
  return { ...versionRow(ctx, p.productId, meta, source, p.version, definition), category: p.category, object_type: p.objectType, recipe_code: p.recipeId, recipe_version_id: ctx.recipeVersionId, definition };
}

export const productFromRow = (r: ProductVersionRow): Versioned<ProductDefinition> => versioned(r, productValue(r));

function productValue(r: ProductVersionRow): ProductDefinition {
  const e = readEnvelope(r);
  if (r.definition.productId !== r.entity_code || r.definition.version !== requireLabel(r)) throw new MappingError(`product ${r.entity_code}: definition does not match its version row`);
  return { ...r.definition, status: engineCalculationStatus(e.status) };
}

export interface RecipeVersionRow extends VersionRow {
  readonly product_type: string;
  readonly definition: Omit<ConstructionRecipe, "status">;
}

export function recipeToRow(recipe: ConstructionRecipe, meta: VersionMeta, ctx: MapContext, source: string): RecipeVersionRow {
  checkEngineStatus(`recipe ${recipe.recipeId}`, recipe.status, meta);
  const definition = omit(recipe, "status");
  return { ...versionRow(ctx, recipe.recipeId, meta, source, recipe.version, definition), product_type: recipe.productType, definition };
}

export const recipeFromRow = (r: RecipeVersionRow): Versioned<ConstructionRecipe> => versioned(r, recipeValue(r));

function recipeValue(r: RecipeVersionRow): ConstructionRecipe {
  const e = readEnvelope(r);
  if (r.definition.recipeId !== r.entity_code || r.definition.version !== requireLabel(r)) throw new MappingError(`recipe ${r.entity_code}: definition does not match its version row`);
  return { ...r.definition, status: engineCalculationStatus(e.status) };
}

/* ------------------------------------------------------------ hardware rule sets (hardware domain) */

export type HardwareRuleSetVersionRow = VersionRow;

export interface HardwareRuleRow {
  readonly org_id: string;
  readonly version_id: string;
  /** Rule order is data (first match wins); stored explicitly. */
  readonly position: number;
  readonly rule_code: string;
  readonly component_type: ComponentType;
  readonly category: HardwareCategory;
  readonly application: HardwareRule["application"];
  /** `null` for a `RunnerHardwareRule`: a drawer has no mounting mode to map. */
  readonly mounting_parameter_key: string | null;
  readonly mounting_map: Readonly<Record<string, HingeMounting>> | null;
  readonly preferred_manufacturer: string;
}

export interface HardwareRuleSetRows {
  readonly version: HardwareRuleSetVersionRow;
  readonly rules: readonly HardwareRuleRow[];
}

export function hardwareRuleSetToRows(s: HardwareRuleSet, meta: VersionMeta, ctx: MapContext, source: string): HardwareRuleSetRows {
  checkEngineStatus(`hardware rule set ${s.ruleSetId}`, s.status, meta);
  const rules = s.rules.map((r, position) => ({
    org_id: ctx.orgId,
    version_id: meta.versionId,
    position,
    rule_code: r.ruleId,
    component_type: r.componentType,
    category: r.category,
    application: r.application,
    mounting_parameter_key: r.application === "HINGED_DOOR" ? r.mounting.parameterKey : null,
    mounting_map: r.application === "HINGED_DOOR" ? r.mounting.map : null,
    preferred_manufacturer: r.preferredManufacturer,
  }));
  const content = omit(s, "status");
  return { version: versionRow(ctx, s.ruleSetId, meta, source, s.version, content), rules };
}

/** Rule order is significant data: rows are ordered by `position`. */
export const hardwareRuleSetFromRows = (rows: HardwareRuleSetRows): Versioned<HardwareRuleSet> => versioned(rows.version, hardwareRuleSetValue(rows));

function hardwareRuleSetValue(rows: HardwareRuleSetRows): HardwareRuleSet {
  const e = readEnvelope(rows.version);
  const seen = new Set<string>();
  const ordered = [...rows.rules].sort((a, b) => a.position - b.position);
  if (ordered.some((r, i) => r.position !== i)) throw new MappingError(`hardware rule set ${rows.version.entity_code}: rule positions must be 0..n-1`);
  const rules: HardwareRule[] = ordered.map((r) => {
    if (seen.has(r.rule_code)) throw new MappingError(`duplicate hardware rule ${r.rule_code}`);
    seen.add(r.rule_code);
    if (r.application === "HINGED_DOOR") {
      if (r.mounting_parameter_key === null || r.mounting_map === null) throw new MappingError(`hardware rule ${r.rule_code}: a HINGED_DOOR rule requires a mounting map`);
      return {
        ruleId: r.rule_code, componentType: r.component_type, category: r.category as "HINGE" | "MOUNTING_PLATE", application: "HINGED_DOOR",
        mounting: { parameterKey: r.mounting_parameter_key, map: r.mounting_map }, preferredManufacturer: r.preferred_manufacturer,
      };
    }
    return { ruleId: r.rule_code, componentType: r.component_type, category: "RUNNER", application: "DRAWER", preferredManufacturer: r.preferred_manufacturer };
  });
  return { ruleSetId: rows.version.entity_code, version: requireLabel(rows.version), status: engineCalculationStatus(e.status), rules };
}

