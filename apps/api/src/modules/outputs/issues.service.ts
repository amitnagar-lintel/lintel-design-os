import { Inject, Injectable } from "@nestjs/common";
import type { RequestScope } from "../../common/auth/context.js";
import { UnitOfWork } from "../../common/db/unit-of-work.js";
import { ApiProblem } from "../../common/errors/api-problem.js";
import { iso } from "../../common/http/format.js";
import type { IdempotentRequest } from "../../common/http/request.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import type { DrawingIssueRow, QuotationIssueRow } from "../../infrastructure/persistence/issues.repository.js";
import { issuesRepository } from "../../infrastructure/persistence/issues.repository.js";
import type { DrawingIssueRequest, DrawingIssueResponse, QuotationIssueRequest, QuotationIssueResponse } from "./outputs.schemas.js";

export const toQuotationIssue = (r: QuotationIssueRow): QuotationIssueResponse => ({
  kind: "QUOTATION", snapshotId: r.snapshot_id, projectId: r.project_id, designVersionId: r.design_version_id, contentHash: r.content_hash, revisionNumber: r.revision_number,
  pricingStandardVersionId: r.pricing_standard_version_id, quotationPolicyVersionId: r.quotation_policy_version_id, issuedBy: r.issued_by, issuedAt: iso(r.issued_at), reason: r.reason,
});
export const toDrawingIssue = (r: DrawingIssueRow): DrawingIssueResponse => ({
  kind: "DRAWING", snapshotId: r.snapshot_id, projectId: r.project_id, designVersionId: r.design_version_id, contentHash: r.content_hash, drawingNumber: r.drawing_number,
  drawingRevision: r.drawing_revision, fileManifestHash: r.file_manifest_hash, issuedBy: r.issued_by, issuedAt: iso(r.issued_at), reason: r.reason,
});

const alreadyIssued = (what: string) => new ApiProblem("ALREADY_ISSUED", `${what} is already issued; an issue is immutable — generate and issue a new revision instead`);

/**
 * Issue (finalization): one immutable decision record per FOR_PRODUCTION quotation / drawing of a LOCKED design,
 * written through RLS (the issue action, as the current user) and design_os.check_issue (every precondition, and the
 * derived record: project, design version, revision, content hash, exact commercial versions / file manifest). Issuing
 * a quotation also LOCKs its exact PricingStandard and QuotationPolicy versions (database trigger), in the same
 * transaction. The issue itself is audited in the hash-chained audit log with the reason and the request id.
 */
@Injectable()
export class IssuesService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  issueQuotation(scope: RequestScope, snapshotId: string, req: IdempotentRequest, b: QuotationIssueRequest) {
    return this.uow.run(scope, { action: "quotation.issue", reason: b.reason }, (tx) =>
      this.idempotency.forRequest(tx, scope, "quotation.issue", req, b, async () => {
        const row = await issuesRepository.issueQuotation(tx, {
          orgId: scope.org.orgId, snapshotId, issuedBy: scope.principal.userId, reason: b.reason, contentHash: b.expectedContentHash,
          pricingStandardVersionId: b.pricingStandardVersionId, quotationPolicyVersionId: b.quotationPolicyVersionId,
        });
        if (row === "already_issued") throw alreadyIssued(`quotation snapshot ${snapshotId} (or its revision)`);
        return { status: 201, body: toQuotationIssue(row), headers: { location: `/api/v1/quotation-snapshots/${snapshotId}/issue` } };
      }));
  }

  issueDrawing(scope: RequestScope, snapshotId: string, req: IdempotentRequest, b: DrawingIssueRequest) {
    return this.uow.run(scope, { action: "drawing.issue", reason: b.reason }, (tx) =>
      this.idempotency.forRequest(tx, scope, "drawing.issue", req, b, async () => {
        const row = await issuesRepository.issueDrawing(tx, { orgId: scope.org.orgId, snapshotId, issuedBy: scope.principal.userId, reason: b.reason, contentHash: b.expectedContentHash });
        if (row === "already_issued") throw alreadyIssued(`drawing snapshot ${snapshotId} (or its drawing number and revision)`);
        return { status: 201, body: toDrawingIssue(row), headers: { location: `/api/v1/drawing-snapshots/${snapshotId}/issue` } };
      }));
  }

  quotationIssue(scope: RequestScope, snapshotId: string) {
    return this.uow.run(scope, { readOnly: true }, async (tx) => {
      const r = await issuesRepository.quotation(tx, snapshotId);
      if (r === null) throw new ApiProblem("NOT_FOUND", "the quotation snapshot is not issued (or not visible)");
      return toQuotationIssue(r);
    });
  }

  drawingIssue(scope: RequestScope, snapshotId: string) {
    return this.uow.run(scope, { readOnly: true }, async (tx) => {
      const r = await issuesRepository.drawing(tx, snapshotId);
      if (r === null) throw new ApiProblem("NOT_FOUND", "the drawing snapshot is not issued (or not visible)");
      return toDrawingIssue(r);
    });
  }
}
