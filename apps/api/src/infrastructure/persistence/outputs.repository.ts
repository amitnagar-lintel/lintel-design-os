import type { Tx } from "../../common/db/tx.js";
import type { Keyset } from "./json.js";
import { jsonRow, jsonRows } from "./json.js";

/**
 * Output snapshots (M5 Step 7): SQL only. Snapshots are insert-only; they are found by id or by their exact natural
 * identity (the unique index of their table) — never by "latest". Hashes and calculations are the services' and the
 * database's (design_os.output_dependency_hashes / version_content_hash), never computed here.
 */
export type SnapshotTable = "bom_snapshot" | "boq_snapshot" | "pricing_snapshot" | "quotation_snapshot" | "drawing_snapshot" | "manufacturing_document_snapshot";
export type SnapshotRowData = Record<string, unknown> & { readonly id: string };

const JSONB = new Set(["dependency_hashes", "engine_closure", "payload"]);

/** Version table of each pinned / chosen dependency subject (for "newer version" advisories). */
const VERSION_TABLE: Readonly<Record<string, string>> = {
  construction_standard_version_id: "construction_standard_version", planning_standard_version_id: "planning_standard_version",
  edge_band_standard_version_id: "edge_band_standard_version", material_catalog_version_id: "material_catalog_version",
  finish_catalog_version_id: "finish_catalog_version", hardware_catalog_version_id: "hardware_catalog_version",
  appliance_catalog_version_id: "appliance_catalog_version", product_catalog_version_id: "product_catalog_version",
  hettich_dataset_version_id: "hettich_dataset_version", pricing_standard_version_id: "pricing_standard_version",
  quotation_policy_version_id: "quotation_policy_version", manufacturing_standard_version_id: "manufacturing_standard_version",
};

export const outputsRepository = {
  /** Engineering (and chosen commercial) dependency content hashes, computed by the database (0017). */
  dependencyHashes(tx: Tx, designVersionId: string, pricingStandardVersionId: string | null, quotationPolicyVersionId: string | null): Promise<Record<string, string>> {
    return tx.one<{ h: Record<string, string> }>("SELECT design_os.output_dependency_hashes($1, $2, $3) AS h", [designVersionId, pricingStandardVersionId, quotationPolicyVersionId]).then((r) => r.h);
  },

  get(tx: Tx, table: SnapshotTable, id: string): Promise<SnapshotRowData | null> {
    return jsonRow<SnapshotRowData>(tx, `SELECT * FROM design_os.${table} WHERE id = $1`, [id]);
  },

  /** The one snapshot with exactly this natural identity (every identity column compared, NULL-safe), if any. */
  findByIdentity(tx: Tx, table: SnapshotTable, identity: Readonly<Record<string, unknown>>): Promise<SnapshotRowData | null> {
    const cols = Object.keys(identity);
    const where = cols.map((c, i) => `${c} IS NOT DISTINCT FROM $${String(i + 1)}`).join(" AND ");
    return jsonRow<SnapshotRowData>(tx, `SELECT * FROM design_os.${table} WHERE ${where}`, cols.map((c) => identity[c]));
  },

  /**
   * Insert one immutable snapshot inside a savepoint. A unique violation on the natural identity (a concurrent
   * generation of the same output, or of the same next quotation revision number) is reported as a conflict.
   */
  async insert(tx: Tx, table: SnapshotTable, row: Readonly<Record<string, unknown>>): Promise<"inserted" | "identity_conflict"> {
    const cols = Object.keys(row);
    const values = cols.map((c) => (JSONB.has(c) ? JSON.stringify(row[c]) : row[c]));
    const placeholders = cols.map((c, i) => `$${String(i + 1)}${JSONB.has(c) ? "::jsonb" : ""}`).join(", ");
    await tx.query("SAVEPOINT output_insert");
    try {
      await tx.query(`INSERT INTO design_os.${table} (${cols.join(", ")}) VALUES (${placeholders})`, values);
    } catch (e) {
      const err = e as { code?: string; constraint?: string };
      await tx.query("ROLLBACK TO SAVEPOINT output_insert");
      if (err.code === "23505" && typeof err.constraint === "string" && (err.constraint.endsWith("_identity") || err.constraint === "quotation_snapshot_revision_unique")) return "identity_conflict";
      throw e;
    }
    await tx.query("RELEASE SAVEPOINT output_insert");
    return "inserted";
  },

  nextQuotationRevision(tx: Tx, designVersionId: string): Promise<number> {
    return tx.one<{ n: number }>("SELECT coalesce(max(revision_number), 0)::int + 1 AS n FROM design_os.quotation_snapshot WHERE design_version_id = $1", [designVersionId]).then((r) => r.n);
  },

  list(tx: Tx, table: SnapshotTable, designVersionId: string, page: Keyset, params: readonly unknown[]): Promise<SnapshotRowData[]> {
    return jsonRows<SnapshotRowData>(tx, `SELECT * FROM design_os.${table} WHERE design_version_id = $1 AND ${page.where} ${page.orderLimit}`, [designVersionId, ...params]);
  },

  /** Every snapshot of a design version in one table (the outputs graph; no pagination — one version's outputs). */
  all(tx: Tx, table: SnapshotTable, designVersionId: string): Promise<SnapshotRowData[]> {
    return jsonRows<SnapshotRowData>(tx, `SELECT * FROM design_os.${table} WHERE design_version_id = $1 ORDER BY created_at, id`, [designVersionId]);
  },

  /** The transaction timestamp (UTC ISO), used as every engine's `createdAt` in one execution context. */
  now(tx: Tx): Promise<string> {
    return tx.one<{ t: string }>(`SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS t`).then((r) => r.t);
  },

  /** Title-block facts of a design version from records: project code, designer (author), checker (approver, if any). */
  titleBlockRecords(tx: Tx, designVersionId: string): Promise<{ project_code: string; designer: string; checker: string | null }> {
    return tx.one<{ project_code: string; designer: string; checker: string | null }>(`SELECT p.project_code,
        coalesce((SELECT u.display_name FROM design_os.app_user u WHERE u.id = v.created_by), v.created_by::text) AS designer,
        CASE WHEN v.approved_by IS NULL THEN NULL ELSE coalesce((SELECT u.display_name FROM design_os.app_user u WHERE u.id = v.approved_by), v.approved_by::text) END AS checker
      FROM design_os.design_version v JOIN design_os.project p ON p.id = v.project_id WHERE v.id = $1`, [designVersionId]);
  },

  hasPermission(tx: Tx, action: string): Promise<boolean> {
    return tx.one<{ ok: boolean }>("SELECT design_os.has_permission($1) AS ok", [action]).then((r) => r.ok);
  },

  /** Whether the design version's room has a survey revision later than the one it pins (advisory, never staleness). */
  newerSurveyAvailable(tx: Tx, roomRevisionId: string): Promise<boolean> {
    return tx.one<{ newer: boolean }>(`SELECT EXISTS (SELECT 1 FROM design_os.room_revision n WHERE n.room_id = rr.room_id AND n.revision_number > rr.revision_number) AS newer
      FROM design_os.room_revision rr WHERE rr.id = $1`, [roomRevisionId]).then((r) => r.newer);
  },

  /** For each exact pinned / chosen version, a later APPROVED or LOCKED version of the same entity, if one exists. */
  async newerVersions(tx: Tx, pins: Readonly<Record<string, string>>): Promise<{ pin: string; versionId: string }[]> {
    const out: { pin: string; versionId: string }[] = [];
    for (const pin of Object.keys(pins).sort()) {
      const table = VERSION_TABLE[pin];
      if (table === undefined) continue;
      const r = await tx.maybeOne<{ id: string }>(`SELECT n.id::text AS id FROM design_os.${table} p JOIN design_os.${table} n ON n.entity_id = p.entity_id AND n.org_id = p.org_id
        WHERE p.id = $1 AND n.version_number > p.version_number AND n.status IN ('APPROVED', 'LOCKED') ORDER BY n.version_number DESC LIMIT 1`, [pins[pin]]);
      if (r !== null) out.push({ pin, versionId: r.id });
    }
    return out;
  },
};
