import type { Tx } from "../../common/db/tx.js";
import type { Keyset } from "./json.js";
import { jsonRows } from "./json.js";
import { REFERENCE_TABLES } from "./reference-data.repository.js";

/** SQL for readiness (M6 G7). Read-only; RLS and the 0020 wrappers bound everything to the caller's organization. */
export interface LedgerRow {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
}

export interface VersionStateRow {
  readonly entity_code: string;
  readonly id: string;
  readonly version_number: number;
  readonly status: "DRAFT" | "IN_REVIEW" | "APPROVED" | "LOCKED" | "SUPERSEDED";
}

export interface AuditRow {
  readonly seq: number;
  readonly id: string;
  readonly occurred_at: string;
  readonly actor_user_id: string | null;
  readonly action: "INSERT" | "UPDATE" | "DELETE";
  readonly table_name: string;
  readonly row_id: string | null;
  readonly old_value: unknown;
  readonly new_value: unknown;
  readonly reason: string | null;
  readonly request_id: string | null;
  readonly prev_hash: string | null;
  readonly row_hash: string;
}

export interface AuditFilter {
  readonly table: string | null;
  readonly rowId: string | null;
  readonly actorUserId: string | null;
  readonly from: string | null;
  readonly to: string | null;
}

export const readinessRepository = {
  /** The migration ledger (0020 grants the API role read access). */
  async ledger(tx: Tx): Promise<LedgerRow[]> {
    return tx.query<LedgerRow & Record<string, unknown>>("SELECT version, name, checksum FROM design_os_migrations.applied ORDER BY version");
  },
  async ping(tx: Tx): Promise<boolean> {
    return (await tx.one<{ ok: boolean }>("SELECT current_user = 'design_os_api' AS ok")).ok;
  },
  /** Every PRODUCTION version of a reference type in the caller's organization (id, entity code, number, status). */
  versions(tx: Tx, type: string): Promise<VersionStateRow[]> {
    const t = REFERENCE_TABLES[type];
    if (t === undefined) throw new Error(`unknown reference type ${type}`);
    return jsonRows<VersionStateRow>(tx, `SELECT e.code AS entity_code, v.id, v.version_number, v.status
      FROM design_os.${t.version} v JOIN design_os.${t.entity} e ON e.org_id = v.org_id AND e.id = v.entity_id
      WHERE v.org_id = design_os.current_org_id() AND v.data_classification = 'PRODUCTION' ORDER BY e.code COLLATE "C", v.version_number`);
  },
  async approvalProblems(tx: Tx, type: string, id: string): Promise<{ code: string; message: string }[]> {
    return (await tx.query<{ problem_code: string; problem_message: string }>("SELECT problem_code, problem_message FROM design_os.reference_approval_problems($1, $2)", [type, id]))
      .map((r) => ({ code: r.problem_code, message: r.problem_message }));
  },
  async auditChain(tx: Tx): Promise<{ ok: boolean; checked: number; first_bad_id: number | null } | null> {
    return tx.maybeOne<{ ok: boolean; checked: number; first_bad_id: number | null }>(
      "SELECT ok, checked::int AS checked, first_bad_id::int AS first_bad_id FROM design_os.audit_chain_status()");
  },
  /** Audit entries of the caller's organization (RLS: audit.read), newest first. The org id is the keyset tiebreaker. */
  audit(tx: Tx, f: AuditFilter, page: Keyset, params: readonly unknown[]): Promise<AuditRow[]> {
    return jsonRows<AuditRow>(tx, `SELECT * FROM (
        SELECT a.id AS seq, a.org_id AS id, a.occurred_at, a.actor_user_id, a.action, a.table_name, a.row_id, a.old_value, a.new_value, a.reason, a.request_id, a.prev_hash, a.row_hash
        FROM design_os.audit_log a
        WHERE a.org_id = design_os.current_org_id() AND ($1::text IS NULL OR a.table_name = $1) AND ($2::text IS NULL OR a.row_id = $2)
          AND ($3::uuid IS NULL OR a.actor_user_id = $3) AND ($4::timestamptz IS NULL OR a.occurred_at >= $4) AND ($5::timestamptz IS NULL OR a.occurred_at < $5)) x
      WHERE ${page.where} ${page.orderLimit}`, [f.table, f.rowId, f.actorUserId, f.from, f.to, ...params]);
  },
};
