import type { Tx } from "../../common/db/tx.js";
import type { Keyset } from "./json.js";
import { jsonRow, jsonRows } from "./json.js";

/**
 * Read-only SQL over the versioned reference data (0003–0005). Table and column names come only from the trusted
 * registry below, never from a request. Every statement runs under RLS (internal members with `reference.read`, own
 * organization only) and reads PRODUCTION rows only.
 */
interface Child {
  /** Name in the response. */
  readonly name: string;
  readonly table: string;
  readonly fk: string;
  readonly orderBy: string;
  /** Large collections are counted here and paged through their own route. */
  readonly paged?: boolean;
}
interface TableSet {
  readonly version: string;
  readonly entity: string;
  readonly children: readonly Child[];
}

const values = (t: string): Child => ({ name: "values", table: t, fk: "version_id", orderBy: "variable_code" });
const members = (domain: string, item: string, name: string): Child => ({ name, table: `${domain}_catalog_version_${item}`, fk: "catalog_version_id", orderBy: `${item}_id, ${item}_version_id` });

export const REFERENCE_TABLES: Readonly<Record<string, TableSet>> = {
  construction_standard: { version: "construction_standard_version", entity: "construction_standard", children: [values("construction_standard_value")] },
  planning_standard: { version: "planning_standard_version", entity: "planning_standard", children: [values("planning_standard_value")] },
  edge_band_standard: { version: "edge_band_standard_version", entity: "edge_band_standard", children: [
    { name: "ruleSets", table: "edge_band_rule_set", fk: "version_id", orderBy: "rule_set_code" },
    { name: "rules", table: "edge_band_rule", fk: "version_id", orderBy: "rule_set_code, component_type, edge_side NULLS FIRST" },
  ] },
  material: { version: "material_version", entity: "material", children: [] },
  edge_band: { version: "edge_band_version", entity: "edge_band", children: [] },
  finish: { version: "finish_version", entity: "finish", children: [{ name: "materialCompatibility", table: "finish_material_compatibility", fk: "finish_version_id", orderBy: "material_id" }] },
  hardware_item: { version: "hardware_item_version", entity: "hardware_item", children: [] },
  hardware_rule_set: { version: "hardware_rule_set_version", entity: "hardware_rule_set", children: [{ name: "rules", table: "hardware_rule", fk: "version_id", orderBy: "position" }] },
  appliance: { version: "appliance_version", entity: "appliance", children: [] },
  construction_recipe: { version: "recipe_version", entity: "construction_recipe", children: [] },
  product: { version: "product_version", entity: "product", children: [] },
  material_catalog: { version: "material_catalog_version", entity: "material_catalog", children: [members("material", "material", "materials"), members("material", "edge_band", "edgeBands")] },
  finish_catalog: { version: "finish_catalog_version", entity: "finish_catalog", children: [members("finish", "finish", "finishes")] },
  hardware_catalog: { version: "hardware_catalog_version", entity: "hardware_catalog", children: [members("hardware", "hardware_item", "hardwareItems"), members("hardware", "hardware_rule_set", "hardwareRuleSets")] },
  appliance_catalog: { version: "appliance_catalog_version", entity: "appliance_catalog", children: [members("appliance", "appliance", "appliances")] },
  product_catalog: { version: "product_catalog_version", entity: "product_catalog", children: [members("product", "product", "products")] },
  hettich_dataset: { version: "hettich_dataset_version", entity: "hettich_dataset", children: [
    { name: "articles", table: "hettich_article", fk: "version_id", orderBy: "position", paged: true },
    { name: "calculationRules", table: "hettich_calculation_rule", fk: "version_id", orderBy: "position", paged: true },
  ] },
  pricing_standard: { version: "pricing_standard_version", entity: "pricing_standard", children: [{ name: "rateCardLines", table: "rate_card_line", fk: "version_id", orderBy: "measure, item_key" }] },
  quotation_policy: { version: "quotation_policy_version", entity: "quotation_policy", children: [
    { name: "taxRates", table: "tax_rate", fk: "version_id", orderBy: "rate_code" },
    { name: "taxRateMappings", table: "tax_rate_mapping", fk: "version_id", orderBy: "product_category" },
  ] },
};

export const ENVELOPE_COLUMNS = [
  "id", "org_id", "entity_id", "version_number", "version_label", "status", "data_classification", "source", "source_ref", "change_reason",
  "created_by", "created_at", "submitted_by", "submitted_at", "approved_by", "approved_at", "effective_from", "locked_by", "locked_at",
  "superseded_by", "superseded_at", "content_hash", "row_version",
] as const;

export interface VersionRow {
  readonly id: string;
  readonly entity_id: string;
  readonly entity_code: string;
  readonly version_number: number;
  readonly version_label: string | null;
  readonly status: "DRAFT" | "IN_REVIEW" | "APPROVED" | "LOCKED" | "SUPERSEDED";
  readonly data_classification: "PRODUCTION";
  readonly source: string;
  readonly source_ref: Record<string, unknown> | null;
  readonly change_reason: string;
  readonly created_by: string;
  readonly created_at: string;
  readonly submitted_by: string | null;
  readonly submitted_at: string | null;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly effective_from: string | null;
  readonly locked_by: string | null;
  readonly locked_at: string | null;
  readonly superseded_by: string | null;
  readonly superseded_at: string | null;
  readonly content_hash: string;
  readonly row_version: number;
}

export interface EntityRow {
  readonly id: string;
  readonly code: string;
  readonly created_at: string;
  readonly version_count: number;
  readonly versions: readonly { id: string; version_number: number; version_label: string | null; status: VersionRow["status"] }[];
}

/** A Hettich row with its position (the page key) and dataset version id (the keyset tiebreaker). */
export interface PositionedRow {
  readonly r: Record<string, unknown>;
  readonly position: number;
  readonly id: string;
}

function tables(type: string): TableSet {
  const t = REFERENCE_TABLES[type];
  if (t === undefined) throw new Error(`unknown reference type ${type}`);
  return t;
}

const ENVELOPE_SELECT = ENVELOPE_COLUMNS.filter((c) => c !== "org_id").map((c) => `v.${c}`).join(", ");

export const referenceDataRepository = {
  /** Entities with their version summaries (newest first), in code order. */
  entities(tx: Tx, type: string, code: string | null, page: Keyset, params: readonly unknown[]): Promise<EntityRow[]> {
    const t = tables(type);
    return jsonRows<EntityRow>(tx, `SELECT * FROM (
        SELECT e.id, e.code, e.created_at,
          (SELECT count(*)::int FROM design_os.${t.version} v WHERE v.org_id = e.org_id AND v.entity_id = e.id AND v.data_classification = 'PRODUCTION') AS version_count,
          coalesce((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'version_number', v.version_number, 'version_label', v.version_label, 'status', v.status) ORDER BY v.version_number DESC)
                    FROM design_os.${t.version} v WHERE v.org_id = e.org_id AND v.entity_id = e.id AND v.data_classification = 'PRODUCTION'), '[]'::jsonb) AS versions
        FROM design_os.${t.entity} e
        WHERE e.org_id = design_os.current_org_id() AND ($1::text IS NULL OR e.code = $1)) x
      WHERE ${page.where} ${page.orderLimit}`, [code, ...params]);
  },
  versions(tx: Tx, type: string, f: { entityCode: string | null; entityId: string | null; statuses: readonly string[] | null }, page: Keyset, params: readonly unknown[]): Promise<VersionRow[]> {
    const t = tables(type);
    return jsonRows<VersionRow>(tx, `SELECT * FROM (
        SELECT ${ENVELOPE_SELECT}, e.code AS entity_code FROM design_os.${t.version} v JOIN design_os.${t.entity} e ON e.org_id = v.org_id AND e.id = v.entity_id
        WHERE v.org_id = design_os.current_org_id() AND v.data_classification = 'PRODUCTION'
          AND ($1::text IS NULL OR e.code = $1) AND ($2::uuid IS NULL OR v.entity_id = $2)
          AND ($3::text[] IS NULL OR v.status::text = ANY ($3::text[]))) x
      WHERE ${page.where} ${page.orderLimit}`, [f.entityCode, f.entityId, f.statuses, ...params]);
  },
  version(tx: Tx, type: string, id: string): Promise<(VersionRow & { content: Record<string, unknown> }) | null> {
    const t = tables(type);
    return jsonRow(tx, `SELECT ${ENVELOPE_SELECT}, e.code AS entity_code, to_jsonb(v) - $2::text[] AS content
      FROM design_os.${t.version} v JOIN design_os.${t.entity} e ON e.org_id = v.org_id AND e.id = v.entity_id
      WHERE v.id = $1 AND v.org_id = design_os.current_org_id() AND v.data_classification = 'PRODUCTION'`, [id, ENVELOPE_COLUMNS]);
  },
  /** Every non-paged child collection of a version, without the tenant / parent key columns. */
  async children(tx: Tx, type: string, versionId: string): Promise<{ children: Record<string, Record<string, unknown>[]>; counts: Record<string, number> }> {
    const children: Record<string, Record<string, unknown>[]> = {};
    const counts: Record<string, number> = {};
    for (const c of tables(type).children) {
      if (c.paged === true) {
        counts[c.name] = (await tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM design_os.${c.table} WHERE ${c.fk} = $1 AND org_id = design_os.current_org_id()`, [versionId])).n;
      } else {
        children[c.name] = await jsonRows<Record<string, unknown>>(tx,
          `SELECT to_jsonb(x) - ARRAY['org_id', '${c.fk}'] AS r FROM design_os.${c.table} x WHERE ${c.fk} = $1 AND org_id = design_os.current_org_id() ORDER BY ${c.orderBy}`, [versionId])
          .then((rows) => rows.map((r) => (r as { r: Record<string, unknown> }).r));
      }
    }
    return { children, counts };
  },
  /** Hettich articles / calculation rules of one dataset version, by position (paged). */
  hettichRows(tx: Tx, table: "hettich_article" | "hettich_calculation_rule", versionId: string, category: string | null, page: Keyset, params: readonly unknown[]): Promise<PositionedRow[]> {
    return jsonRows<PositionedRow>(tx, `SELECT * FROM (
        SELECT to_jsonb(a) - ARRAY['org_id', 'version_id'] AS r, a.position::bigint AS position, a.version_id AS id
        FROM design_os.${table} a WHERE a.version_id = $1 AND a.org_id = design_os.current_org_id() AND ($2::text IS NULL OR a.category = $2)) x
      WHERE ${page.where} ${page.orderLimit}`, [versionId, category, ...params]);
  },
};
