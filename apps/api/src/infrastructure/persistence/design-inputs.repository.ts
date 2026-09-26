import type { Tx } from "../../common/db/tx.js";
import { jsonRow, jsonRows } from "./json.js";

/**
 * Loads the EXACT versions a DesignVersion pins — standards, catalog versions with their frozen member item versions,
 * product recipes and the Hettich dataset — as rows (reference data is readable under RLS with `reference.read`).
 * No mapping or calculation here: the application service maps rows with @lintel/persistence and runs the engines.
 */
type Row = Record<string, unknown>;
export type VersionRowWithCode = Row & { readonly entity_code: string };

async function versionWithCode(tx: Tx, versionTable: string, entityTable: string, id: string | null): Promise<VersionRowWithCode | null> {
  if (id === null) return null;
  return jsonRow<VersionRowWithCode>(tx, `SELECT v.*, e.code AS entity_code FROM design_os.${versionTable} v JOIN design_os.${entityTable} e ON e.id = v.entity_id WHERE v.id = $1`, [id]);
}

async function members(tx: Tx, memberTable: string, itemVersionColumn: string, versionTable: string, entityTable: string, catalogVersionId: string): Promise<VersionRowWithCode[]> {
  return jsonRows<VersionRowWithCode>(tx, `
    SELECT v.*, e.code AS entity_code FROM design_os.${memberTable} m
      JOIN design_os.${versionTable} v ON v.id = m.${itemVersionColumn}
      JOIN design_os.${entityTable} e ON e.id = v.entity_id
    WHERE m.catalog_version_id = $1 ORDER BY e.code COLLATE "C"`, [catalogVersionId]);
}

export interface PinnedInputRows {
  readonly construction: { readonly version: VersionRowWithCode | null; readonly values: Row[] };
  readonly planning: { readonly version: VersionRowWithCode | null; readonly values: Row[] };
  readonly edgeBand: { readonly version: VersionRowWithCode | null; readonly ruleSets: Row[]; readonly rules: Row[] };
  readonly material: { readonly catalog: VersionRowWithCode | null; readonly materials: VersionRowWithCode[]; readonly edgeBands: VersionRowWithCode[] };
  readonly finish: { readonly catalog: VersionRowWithCode | null; readonly finishes: VersionRowWithCode[] };
  readonly hardware: { readonly catalog: VersionRowWithCode | null; readonly ruleSets: { readonly version: VersionRowWithCode; readonly rules: Row[] }[] };
  readonly product: { readonly catalog: VersionRowWithCode | null; readonly products: VersionRowWithCode[]; readonly recipes: VersionRowWithCode[] };
  readonly hettich: { readonly version: VersionRowWithCode | null; readonly articles: Row[]; readonly calculationRules: Row[] };
}

export interface Pins {
  readonly construction_standard_version_id: string;
  readonly planning_standard_version_id: string;
  readonly edge_band_standard_version_id: string;
  readonly material_catalog_version_id: string;
  readonly finish_catalog_version_id: string;
  readonly hardware_catalog_version_id: string;
  readonly product_catalog_version_id: string;
  readonly hettich_dataset_version_id: string;
}

export const designInputsRepository = {
  async pinned(tx: Tx, p: Pins): Promise<PinnedInputRows> {
    const values = (table: string, id: string) => jsonRows<Row>(tx, `SELECT * FROM design_os.${table} WHERE version_id = $1 ORDER BY variable_code COLLATE "C"`, [id]);
    const hardwareRuleSets = await members(tx, "hardware_catalog_version_hardware_rule_set", "hardware_rule_set_version_id", "hardware_rule_set_version", "hardware_rule_set", p.hardware_catalog_version_id);
    const products = await members(tx, "product_catalog_version_product", "product_version_id", "product_version", "product", p.product_catalog_version_id);
    const recipeIds = [...new Set(products.map((x) => String(x.recipe_version_id)))];
    return {
      construction: { version: await versionWithCode(tx, "construction_standard_version", "construction_standard", p.construction_standard_version_id), values: await values("construction_standard_value", p.construction_standard_version_id) },
      planning: { version: await versionWithCode(tx, "planning_standard_version", "planning_standard", p.planning_standard_version_id), values: await values("planning_standard_value", p.planning_standard_version_id) },
      edgeBand: {
        version: await versionWithCode(tx, "edge_band_standard_version", "edge_band_standard", p.edge_band_standard_version_id),
        ruleSets: await jsonRows<Row>(tx, `SELECT * FROM design_os.edge_band_rule_set WHERE version_id = $1 ORDER BY rule_set_code COLLATE "C"`, [p.edge_band_standard_version_id]),
        rules: await jsonRows<Row>(tx, `SELECT * FROM design_os.edge_band_rule WHERE version_id = $1 ORDER BY rule_set_code COLLATE "C", component_type::text COLLATE "C", edge_side::text COLLATE "C"`, [p.edge_band_standard_version_id]),
      },
      material: {
        catalog: await versionWithCode(tx, "material_catalog_version", "material_catalog", p.material_catalog_version_id),
        materials: await members(tx, "material_catalog_version_material", "material_version_id", "material_version", "material", p.material_catalog_version_id),
        edgeBands: await members(tx, "material_catalog_version_edge_band", "edge_band_version_id", "edge_band_version", "edge_band", p.material_catalog_version_id),
      },
      finish: {
        catalog: await versionWithCode(tx, "finish_catalog_version", "finish_catalog", p.finish_catalog_version_id),
        finishes: await members(tx, "finish_catalog_version_finish", "finish_version_id", "finish_version", "finish", p.finish_catalog_version_id),
      },
      hardware: {
        catalog: await versionWithCode(tx, "hardware_catalog_version", "hardware_catalog", p.hardware_catalog_version_id),
        ruleSets: await Promise.all(hardwareRuleSets.map(async (version) => ({
          version,
          rules: await jsonRows<Row>(tx, "SELECT * FROM design_os.hardware_rule WHERE version_id = $1 ORDER BY position", [String(version.id)]),
        }))),
      },
      product: {
        catalog: await versionWithCode(tx, "product_catalog_version", "product_catalog", p.product_catalog_version_id),
        products,
        recipes: await jsonRows<VersionRowWithCode>(tx, `
          SELECT v.*, e.code AS entity_code FROM design_os.recipe_version v JOIN design_os.construction_recipe e ON e.id = v.entity_id
          WHERE v.id = ANY($1::uuid[]) ORDER BY e.code COLLATE "C"`, [recipeIds]),
      },
      hettich: {
        version: await versionWithCode(tx, "hettich_dataset_version", "hettich_dataset", p.hettich_dataset_version_id),
        articles: await jsonRows<Row>(tx, "SELECT * FROM design_os.hettich_article WHERE version_id = $1 ORDER BY position", [p.hettich_dataset_version_id]),
        calculationRules: await jsonRows<Row>(tx, "SELECT * FROM design_os.hettich_calculation_rule WHERE version_id = $1 ORDER BY position", [p.hettich_dataset_version_id]),
      },
    };
  },
};
