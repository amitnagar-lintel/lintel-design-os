import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { RequestScope } from "../../common/auth/context.js";
import { RequiresAction, Scope } from "../../common/auth/decorators.js";
import { idempotentRequest } from "../../common/http/request.js";
import { respond } from "../../common/http/respond.js";
import { SchemaPipe } from "../../common/http/schema.pipe.js";
import { PageQuery } from "../../common/http/schemas.js";
import { VersionId } from "../design-versions/design-versions.schemas.js";
import { BoqGenerateRequest, BomGenerateRequest, PricingGenerateRequest, QuotationGenerateRequest, SnapshotIdParam } from "./outputs.schemas.js";
import { OutputsService } from "./outputs.service.js";

type V = z.infer<typeof VersionId>;
type S = z.infer<typeof SnapshotIdParam>;

/**
 * Output snapshots (M5 Step 7 checkpoint 2): server-orchestrated generation of BOM, BOQ, Pricing and Quotation from one
 * execution context, exact reads and staleness. HTTP only: every rule and calculation is behind OutputsService.
 */
@Controller()
export class OutputsController {
  constructor(@Inject(OutputsService) private readonly outputs: OutputsService) {}

  /* ---------------------------------------------------------------- BOM */

  @Post("design-versions/:versionId/bom-snapshots") @RequiresAction("output.generate.engineering")
  async generateBom(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(VersionId, "params")) p: V,
    @Body(new SchemaPipe(BomGenerateRequest, "body")) b: z.infer<typeof BomGenerateRequest>, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.outputs.generate(s, "BOM", p.versionId, idempotentRequest(req), b));
  }

  @Get("design-versions/:versionId/bom-snapshots") @RequiresAction("output.read.production")
  listBom(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionId, "params")) p: V, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.outputs.list(s, "BOM", p.versionId, q);
  }

  @Get("bom-snapshots/:snapshotId") @RequiresAction("output.read.production")
  getBom(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.get(s, "BOM", p.snapshotId);
  }

  @Get("bom-snapshots/:snapshotId/staleness") @RequiresAction("output.read.production")
  stalenessBom(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.detailedStaleness(s, "BOM", p.snapshotId);
  }

  /* ---------------------------------------------------------------- BOQ */

  @Post("design-versions/:versionId/boq-snapshots") @RequiresAction("output.generate.engineering")
  async generateBoq(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(VersionId, "params")) p: V,
    @Body(new SchemaPipe(BoqGenerateRequest, "body")) b: z.infer<typeof BoqGenerateRequest>, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.outputs.generate(s, "BOQ", p.versionId, idempotentRequest(req), b));
  }

  @Get("design-versions/:versionId/boq-snapshots") @RequiresAction("output.read.production")
  listBoq(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionId, "params")) p: V, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.outputs.list(s, "BOQ", p.versionId, q);
  }

  @Get("boq-snapshots/:snapshotId") @RequiresAction("output.read.production")
  getBoq(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.get(s, "BOQ", p.snapshotId);
  }

  @Get("boq-snapshots/:snapshotId/staleness") @RequiresAction("output.read.production")
  stalenessBoq(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.detailedStaleness(s, "BOQ", p.snapshotId);
  }

  /* ---------------------------------------------------------------- PRICING */

  @Post("design-versions/:versionId/pricing-snapshots") @RequiresAction("output.generate.commercial")
  async generatePricing(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(VersionId, "params")) p: V,
    @Body(new SchemaPipe(PricingGenerateRequest, "body")) b: z.infer<typeof PricingGenerateRequest>, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.outputs.generate(s, "PRICING", p.versionId, idempotentRequest(req), b));
  }

  @Get("design-versions/:versionId/pricing-snapshots") @RequiresAction("output.read.cost")
  listPricing(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionId, "params")) p: V, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.outputs.list(s, "PRICING", p.versionId, q);
  }

  @Get("pricing-snapshots/:snapshotId") @RequiresAction("output.read.cost")
  getPricing(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.get(s, "PRICING", p.snapshotId);
  }

  @Get("pricing-snapshots/:snapshotId/staleness") @RequiresAction("output.read.cost")
  stalenessPricing(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.detailedStaleness(s, "PRICING", p.snapshotId);
  }

  /* ---------------------------------------------------------------- QUOTATION */

  @Post("design-versions/:versionId/quotation-snapshots") @RequiresAction("output.generate.commercial")
  async generateQuotation(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(VersionId, "params")) p: V,
    @Body(new SchemaPipe(QuotationGenerateRequest, "body")) b: z.infer<typeof QuotationGenerateRequest>, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.outputs.generate(s, "QUOTATION", p.versionId, idempotentRequest(req), b));
  }

  @Get("design-versions/:versionId/quotation-snapshots") @RequiresAction("output.read.cost")
  listQuotation(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionId, "params")) p: V, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.outputs.list(s, "QUOTATION", p.versionId, q);
  }

  @Get("quotation-snapshots/:snapshotId") @RequiresAction("output.read.cost")
  getQuotation(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.get(s, "QUOTATION", p.snapshotId);
  }

  @Get("quotation-snapshots/:snapshotId/staleness") @RequiresAction("output.read.cost")
  stalenessQuotation(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.detailedStaleness(s, "QUOTATION", p.snapshotId);
  }
}
