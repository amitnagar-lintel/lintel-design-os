import type { Tx } from "../../common/db/tx.js";
import type { Keyset } from "./json.js";
import { jsonRow, jsonRows } from "./json.js";

export type LifecycleStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "LOCKED" | "SUPERSEDED";

/** The 9 exact engineering pins (column names). Commercial / manufacturing versions are chosen per output (0017). */
export const PIN_COLUMNS = [
  "construction_standard_version_id", "planning_standard_version_id", "edge_band_standard_version_id", "material_catalog_version_id", "finish_catalog_version_id",
  "hardware_catalog_version_id", "appliance_catalog_version_id", "product_catalog_version_id", "hettich_dataset_version_id",
] as const;
export type PinColumn = (typeof PIN_COLUMNS)[number];
export type PinColumns = { readonly [K in PinColumn]: string | null };

export interface DesignVersionRow extends PinColumns {
  readonly id: string;
  readonly org_id: string;
  readonly entity_id: string;
  readonly project_id: string;
  readonly based_on_version_id: string | null;
  readonly room_revision_id: string;
  readonly authored_engine_version: string;
  readonly input_hash: string;
  readonly input_revision: number;
  readonly version_number: number;
  readonly version_label: string | null;
  readonly status: LifecycleStatus;
  readonly data_classification: "PRODUCTION";
  readonly source: string;
  readonly source_ref: unknown;
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

export interface DesignObjectRow {
  readonly id: string;
  readonly org_id: string;
  readonly design_version_id: string;
  readonly object_code: string;
  readonly lineage_id: string;
  readonly object_type: "BASE_CABINET";
  readonly product_code: string;
  readonly product_version_id: string;
  readonly x_mm: number;
  readonly y_mm: number;
  readonly z_mm: number;
  readonly rotation_y: 0 | 90 | 180 | 270;
  readonly width_mm: number;
  readonly height_mm: number;
  readonly depth_mm: number;
  readonly parameters: Readonly<Record<string, number | string>>;
  readonly status: "DRAFT" | "APPROVED";
}

export interface RelationshipOverrideRow {
  readonly org_id: string;
  readonly design_version_id: string;
  readonly override_code: string;
  readonly version: number;
  readonly kind: "INTENTIONAL_GAP" | "FILLER" | "END_PANEL" | "SHARED_SIDE" | "SPECIAL_CORNER";
  readonly object_ids: readonly string[];
  readonly reason: string;
  readonly created_by: string;
  readonly created_at: string;
}

export interface ValidationRunRow {
  readonly id: string;
  readonly seq: number;
  readonly org_id: string;
  readonly design_version_id: string;
  readonly input_hash: string;
  readonly input_revision: number;
  /** APPROVAL (SUBMIT / APPROVE evidence) or OUTPUT_GENERATION (evidence for one output-generation context). */
  readonly purpose: "APPROVAL" | "OUTPUT_GENERATION";
  /** NULL only for runs recorded before migration 0017. */
  readonly dependency_set_hash: string | null;
  readonly engine_name: string;
  readonly engine_version: string;
  /** NULL only for runs recorded before migration 0016. */
  readonly engine_build: string | null;
  readonly engine_fingerprint: string;
  /** NULL only for runs recorded before migration 0017. */
  readonly engine_closure: Readonly<Record<string, unknown>> | null;
  readonly content_hash: string;
  readonly blocker_count: number;
  readonly warning_count: number;
  readonly messages: readonly unknown[];
  readonly created_by: string;
  readonly created_at: string;
}

const OBJECT_COLS = "id, org_id, design_version_id, object_code, lineage_id, object_type, product_code, product_version_id, x_mm, y_mm, z_mm, rotation_y, width_mm, height_mm, depth_mm, parameters, status";
const OVERRIDE_COLS = "org_id, design_version_id, override_code, version, kind, object_ids, reason, created_by, created_at";
const RUN_COLS = "id, seq, org_id, design_version_id, input_hash, input_revision, purpose, dependency_set_hash, engine_name, engine_version, engine_build, engine_fingerprint, engine_closure, content_hash, blocker_count, warning_count, messages, created_by, created_at";

export interface NewDesignVersion extends PinColumns {
  readonly id: string;
  readonly org_id: string;
  readonly entity_id: string;
  readonly project_id: string;
  readonly based_on_version_id: string | null;
  readonly room_revision_id: string;
  readonly authored_engine_version: string;
  readonly input_hash: string;
  readonly version_number: number;
  readonly version_label: string | null;
  readonly source: string;
  readonly change_reason: string;
  readonly created_by: string;
  readonly content_hash: string;
}

export const designVersionsRepository = {
  get(tx: Tx, id: string, lock: "none" | "update" | "share" = "none"): Promise<DesignVersionRow | null> {
    const suffix = lock === "update" ? " FOR UPDATE" : lock === "share" ? " FOR SHARE" : "";
    return jsonRow<DesignVersionRow>(tx, `SELECT * FROM design_os.design_version WHERE id = $1${suffix}`, [id]);
  },
  nextVersionNumber(tx: Tx, designId: string): Promise<number> {
    return tx.one<{ n: number }>("SELECT (coalesce(max(version_number), 0) + 1)::int AS n FROM design_os.design_version WHERE entity_id = $1", [designId]).then((r) => r.n);
  },
  insert(tx: Tx, r: NewDesignVersion): Promise<DesignVersionRow | null> {
    const cols = ["id", "org_id", "entity_id", "project_id", "based_on_version_id", "room_revision_id", ...PIN_COLUMNS, "authored_engine_version", "input_hash", "version_number", "version_label", "source", "change_reason", "created_by", "content_hash"] as const;
    const values = cols.map((c) => r[c]);
    return jsonRow<DesignVersionRow>(tx, `INSERT INTO design_os.design_version (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${String(i + 1)}`).join(", ")}) RETURNING *`, values);
  },
  /** Draft content only: status and every lifecycle column are excluded from the API role's UPDATE grant. */
  updateDraft(tx: Tx, id: string, r: PinColumns & Pick<DesignVersionRow, "room_revision_id" | "version_label" | "change_reason" | "source">): Promise<DesignVersionRow | null> {
    const cols = ["room_revision_id", "version_label", "change_reason", "source", ...PIN_COLUMNS] as const;
    return jsonRow<DesignVersionRow>(tx, `UPDATE design_os.design_version SET ${cols.map((c, i) => `${c} = $${String(i + 2)}`).join(", ")} WHERE id = $1 RETURNING *`, [id, ...cols.map((c) => r[c])]);
  },
  setHashes(tx: Tx, id: string, inputHash: string, contentHash: string): Promise<DesignVersionRow | null> {
    return jsonRow<DesignVersionRow>(tx, "UPDATE design_os.design_version SET input_hash = $2, content_hash = $3 WHERE id = $1 RETURNING *", [id, inputHash, contentHash]);
  },
  list(tx: Tx, designId: string, page: Keyset, params: readonly unknown[]): Promise<DesignVersionRow[]> {
    return jsonRows<DesignVersionRow>(tx, `SELECT * FROM design_os.design_version WHERE entity_id = $1 AND ${page.where} ${page.orderLimit}`, [designId, ...params]);
  },
  /** The subject content hash of the latest lifecycle decision recorded for a version in this transaction. */
  latestDecisionHash(tx: Tx, id: string): Promise<string | null> {
    return tx.maybeOne<{ h: string }>("SELECT subject_content_hash AS h FROM design_os.approval_decision WHERE subject_type = 'design' AND subject_id = $1 ORDER BY id DESC LIMIT 1", [id]).then((r) => r?.h ?? null);
  },
  transition(tx: Tx, id: string, action: string, reason: string, expectedContentHash: string | null): Promise<LifecycleStatus> {
    return tx.one<{ s: LifecycleStatus }>("SELECT design_os.transition('design', $1, $2, $3, $4)::text AS s", [id, action, reason, expectedContentHash]).then((r) => r.s);
  },

  /* objects */
  objects(tx: Tx, versionId: string): Promise<DesignObjectRow[]> {
    return jsonRows<DesignObjectRow>(tx, `SELECT ${OBJECT_COLS} FROM design_os.design_object WHERE design_version_id = $1 ORDER BY object_code COLLATE "C"`, [versionId]);
  },
  objectPage(tx: Tx, versionId: string, page: Keyset, params: readonly unknown[]): Promise<DesignObjectRow[]> {
    return jsonRows<DesignObjectRow>(tx, `SELECT ${OBJECT_COLS} FROM design_os.design_object WHERE design_version_id = $1 AND ${page.where} ${page.orderLimit}`, [versionId, ...params]);
  },
  object(tx: Tx, id: string): Promise<DesignObjectRow | null> {
    return jsonRow<DesignObjectRow>(tx, `SELECT ${OBJECT_COLS} FROM design_os.design_object WHERE id = $1`, [id]);
  },
  insertObject(tx: Tx, o: DesignObjectRow): Promise<DesignObjectRow | null> {
    return jsonRow<DesignObjectRow>(tx, `
      INSERT INTO design_os.design_object (${OBJECT_COLS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING ${OBJECT_COLS}`,
      [o.id, o.org_id, o.design_version_id, o.object_code, o.lineage_id, o.object_type, o.product_code, o.product_version_id, o.x_mm, o.y_mm, o.z_mm, o.rotation_y, o.width_mm, o.height_mm, o.depth_mm, JSON.stringify(o.parameters), o.status]);
  },
  updateObject(tx: Tx, o: DesignObjectRow): Promise<DesignObjectRow | null> {
    return jsonRow<DesignObjectRow>(tx, `
      UPDATE design_os.design_object SET product_code = $2, product_version_id = $3, x_mm = $4, y_mm = $5, z_mm = $6, rotation_y = $7, width_mm = $8, height_mm = $9, depth_mm = $10, parameters = $11
      WHERE id = $1 RETURNING ${OBJECT_COLS}`,
      [o.id, o.product_code, o.product_version_id, o.x_mm, o.y_mm, o.z_mm, o.rotation_y, o.width_mm, o.height_mm, o.depth_mm, JSON.stringify(o.parameters)]);
  },
  deleteObject(tx: Tx, id: string): Promise<boolean> {
    return tx.query("DELETE FROM design_os.design_object WHERE id = $1 RETURNING id", [id]).then((r) => r.length === 1);
  },
  /** Product versions of `productVersionIds` that are NOT members of the product catalog version. */
  productsOutsideCatalog(tx: Tx, catalogVersionId: string, productVersionIds: readonly string[]): Promise<string[]> {
    return tx.query<{ id: string }>(`
      SELECT p::text AS id FROM unnest($2::uuid[]) AS p
      WHERE NOT EXISTS (SELECT 1 FROM design_os.product_catalog_version_product m WHERE m.catalog_version_id = $1 AND m.product_version_id = p)`,
      [catalogVersionId, productVersionIds]).then((r) => r.map((x) => x.id));
  },

  /* relationship overrides (versioned history) */
  overrides(tx: Tx, versionId: string): Promise<RelationshipOverrideRow[]> {
    return jsonRows<RelationshipOverrideRow>(tx, `SELECT ${OVERRIDE_COLS} FROM design_os.relationship_override WHERE design_version_id = $1 ORDER BY override_code COLLATE "C", version`, [versionId]);
  },
  nextOverrideVersion(tx: Tx, versionId: string, code: string): Promise<number> {
    return tx.one<{ n: number }>("SELECT (coalesce(max(version), 0) + 1)::int AS n FROM design_os.relationship_override WHERE design_version_id = $1 AND override_code = $2", [versionId, code]).then((r) => r.n);
  },
  insertOverride(tx: Tx, o: Omit<RelationshipOverrideRow, "created_at">): Promise<RelationshipOverrideRow | null> {
    return jsonRow<RelationshipOverrideRow>(tx, `
      INSERT INTO design_os.relationship_override (org_id, design_version_id, override_code, version, kind, object_ids, reason, created_by, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now()) RETURNING ${OVERRIDE_COLS}`,
      [o.org_id, o.design_version_id, o.override_code, o.version, o.kind, o.object_ids, o.reason, o.created_by]);
  },
  insertOverrideCopy(tx: Tx, o: RelationshipOverrideRow): Promise<RelationshipOverrideRow | null> {
    return jsonRow<RelationshipOverrideRow>(tx, `
      INSERT INTO design_os.relationship_override (org_id, design_version_id, override_code, version, kind, object_ids, reason, created_by, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${OVERRIDE_COLS}`,
      [o.org_id, o.design_version_id, o.override_code, o.version, o.kind, o.object_ids, o.reason, o.created_by, o.created_at]);
  },
  deleteOverride(tx: Tx, versionId: string, code: string): Promise<number> {
    return tx.query("DELETE FROM design_os.relationship_override WHERE design_version_id = $1 AND override_code = $2 RETURNING version", [versionId, code]).then((r) => r.length);
  },

  /* validation runs (read-only; written only by design_os.record_validation_run) */
  runs(tx: Tx, versionId: string, page: Keyset, params: readonly unknown[]): Promise<ValidationRunRow[]> {
    return jsonRows<ValidationRunRow>(tx, `SELECT ${RUN_COLS} FROM design_os.validation_run WHERE design_version_id = $1 AND ${page.where} ${page.orderLimit}`, [versionId, ...params]);
  },
  run(tx: Tx, id: string): Promise<ValidationRunRow | null> {
    return jsonRow<ValidationRunRow>(tx, `SELECT ${RUN_COLS} FROM design_os.validation_run WHERE id = $1`, [id]);
  },
  /** The latest APPROVAL run: the evidence SUBMIT / APPROVE use (OUTPUT_GENERATION runs belong to their snapshots). */
  latestRun(tx: Tx, versionId: string): Promise<ValidationRunRow | null> {
    return jsonRow<ValidationRunRow>(tx, `SELECT ${RUN_COLS} FROM design_os.validation_run WHERE design_version_id = $1 AND purpose = 'APPROVAL' ORDER BY seq DESC LIMIT 1`, [versionId]);
  },
  recordRun(tx: Tx, args: readonly unknown[]): Promise<string> {
    return tx.one<{ id: string }>("SELECT design_os.record_validation_run($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb, $12)::text AS id", args).then((r) => r.id);
  },
};
