import type { Tx } from "../../common/db/tx.js";
import { jsonRow } from "./json.js";

export interface QuotationIssueRow extends Record<string, unknown> {
  readonly org_id: string;
  readonly snapshot_id: string;
  readonly project_id: string;
  readonly design_version_id: string;
  readonly revision_number: number;
  readonly content_hash: string;
  readonly pricing_standard_version_id: string;
  readonly quotation_policy_version_id: string;
  readonly issued_by: string;
  readonly issued_at: string;
  readonly reason: string;
}

export interface DrawingIssueRow extends Record<string, unknown> {
  readonly org_id: string;
  readonly snapshot_id: string;
  readonly project_id: string;
  readonly design_version_id: string;
  readonly drawing_number: string;
  readonly drawing_revision: string;
  readonly content_hash: string;
  readonly file_manifest_hash: string;
  readonly issued_by: string;
  readonly issued_at: string;
  readonly reason: string;
}

/** Constraints whose violation means "this snapshot / revision is already issued" (a concurrent issue won). */
const ISSUED = new Set(["quotation_issue_pkey", "quotation_issue_revision_unique", "drawing_issue_pkey", "drawing_issue_number_revision_unique"]);

async function insertIssue<R>(tx: Tx, sql: string, params: readonly unknown[]): Promise<R | "already_issued"> {
  await tx.query("SAVEPOINT issue_insert");
  try {
    const row = await jsonRow<R>(tx, sql, params);
    await tx.query("RELEASE SAVEPOINT issue_insert");
    if (row === null) throw new Error("issue insert returned no row");
    return row;
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err.code === "23505" && err.constraint !== undefined && ISSUED.has(err.constraint)) {
      await tx.query("ROLLBACK TO SAVEPOINT issue_insert");
      return "already_issued";
    }
    throw e;
  }
}

/**
 * Issue records (insert-only decision records): SQL only. design_os.check_issue derives every record column from the
 * snapshot and verifies the declared ones; RLS allows the insert only with the issue action, as the current user.
 */
export const issuesRepository = {
  issueQuotation(tx: Tx, r: { readonly orgId: string; readonly snapshotId: string; readonly issuedBy: string; readonly reason: string; readonly contentHash: string;
    readonly pricingStandardVersionId: string; readonly quotationPolicyVersionId: string }): Promise<QuotationIssueRow | "already_issued"> {
    return insertIssue<QuotationIssueRow>(tx, `INSERT INTO design_os.quotation_issue (org_id, snapshot_id, issued_by, reason, content_hash, pricing_standard_version_id, quotation_policy_version_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [r.orgId, r.snapshotId, r.issuedBy, r.reason, r.contentHash, r.pricingStandardVersionId, r.quotationPolicyVersionId]);
  },

  issueDrawing(tx: Tx, r: { readonly orgId: string; readonly snapshotId: string; readonly issuedBy: string; readonly reason: string; readonly contentHash: string }): Promise<DrawingIssueRow | "already_issued"> {
    return insertIssue<DrawingIssueRow>(tx, `INSERT INTO design_os.drawing_issue (org_id, snapshot_id, issued_by, reason, content_hash) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [r.orgId, r.snapshotId, r.issuedBy, r.reason, r.contentHash]);
  },

  quotation(tx: Tx, snapshotId: string): Promise<QuotationIssueRow | null> {
    return jsonRow<QuotationIssueRow>(tx, "SELECT * FROM design_os.quotation_issue WHERE snapshot_id = $1", [snapshotId]);
  },

  drawing(tx: Tx, snapshotId: string): Promise<DrawingIssueRow | null> {
    return jsonRow<DrawingIssueRow>(tx, "SELECT * FROM design_os.drawing_issue WHERE snapshot_id = $1", [snapshotId]);
  },
};
