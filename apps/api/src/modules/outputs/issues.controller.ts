import { Body, Controller, Get, Inject, Param, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { RequestScope } from "../../common/auth/context.js";
import { AuthenticatedOnly, RequiresAction, Scope } from "../../common/auth/decorators.js";
import { ApiDoc } from "../../common/http/openapi.js";
import { SensitiveRate } from "../../common/http/rate-limit.js";
import { idempotentRequest } from "../../common/http/request.js";
import { respond } from "../../common/http/respond.js";
import { SchemaPipe } from "../../common/http/schema.pipe.js";
import { DrawingIssueRequest, DrawingIssueResponse, QuotationIssueRequest, QuotationIssueResponse, SnapshotIdParam } from "./outputs.schemas.js";
import { IssuesService } from "./issues.service.js";

type S = z.infer<typeof SnapshotIdParam>;

/** Issue (finalization) of FOR_PRODUCTION quotations and drawings of LOCKED designs. HTTP only. */
@Controller()
export class IssuesController {
  constructor(@Inject(IssuesService) private readonly issues: IssuesService) {}

  @SensitiveRate() @Post("quotation-snapshots/:snapshotId/issue") @RequiresAction("quotation.issue")
  @ApiDoc({ summary: "Issue a FOR_PRODUCTION quotation of a LOCKED design (locks its exact commercial versions)", responses: { 201: QuotationIssueResponse }, idempotent: true })
  async issueQuotation(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S,
    @Body(new SchemaPipe(QuotationIssueRequest, "body")) b: QuotationIssueRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.issues.issueQuotation(s, p.snapshotId, idempotentRequest(req), b));
  }

  @Get("quotation-snapshots/:snapshotId/issue") @AuthenticatedOnly()
  @ApiDoc({ summary: "The issue record of a quotation snapshot", responses: { 200: QuotationIssueResponse } })
  quotationIssue(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.issues.quotationIssue(s, p.snapshotId);
  }

  @SensitiveRate() @Post("drawing-snapshots/:snapshotId/issue") @RequiresAction("drawing.issue")
  @ApiDoc({ summary: "Issue a FOR_PRODUCTION drawing of a LOCKED design (its exact sealed file manifest)", responses: { 201: DrawingIssueResponse }, idempotent: true })
  async issueDrawing(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S,
    @Body(new SchemaPipe(DrawingIssueRequest, "body")) b: DrawingIssueRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.issues.issueDrawing(s, p.snapshotId, idempotentRequest(req), b));
  }

  @Get("drawing-snapshots/:snapshotId/issue") @AuthenticatedOnly()
  @ApiDoc({ summary: "The issue record of a drawing snapshot", responses: { 200: DrawingIssueResponse } })
  drawingIssue(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.issues.drawingIssue(s, p.snapshotId);
  }
}
