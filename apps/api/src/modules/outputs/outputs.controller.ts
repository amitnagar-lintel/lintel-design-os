import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { RequestScope } from "../../common/auth/context.js";
import { AuthenticatedOnly, RequiresAction, Scope } from "../../common/auth/decorators.js";
import { idempotentRequest } from "../../common/http/request.js";
import { respond } from "../../common/http/respond.js";
import { SchemaPipe } from "../../common/http/schema.pipe.js";
import { PageQuery } from "../../common/http/schemas.js";
import { VersionId } from "../design-versions/design-versions.schemas.js";
import { BoqGenerateRequest, BomGenerateRequest, DrawingGenerateRequest, PricingGenerateRequest, QuotationGenerateRequest, SnapshotIdParam } from "./outputs.schemas.js";
import { OutputsService } from "./outputs.service.js";
import { ApiDoc } from "../../common/http/openapi.js";
import { DetailedStaleness, GenerateResponse, OutputsGraph, Snapshot, SnapshotEnvelope, SnapshotFiles, UnavailableResponse } from "./outputs.schemas.js";
import { Page } from "../../common/http/schemas.js";

type V = z.infer<typeof VersionId>;
type S = z.infer<typeof SnapshotIdParam>;

/**
 * Output snapshots (M5 Step 7): server-orchestrated generation of BOM, BOQ, Pricing, Quotation and drawings from one
 * execution context, exact reads, staleness, drawing files and the outputs graph. HTTP only: every rule and
 * calculation is behind OutputsService.
 */
@Controller()
export class OutputsController {
  constructor(@Inject(OutputsService) private readonly outputs: OutputsService) {}

  /** Every readable output of a design version, its OUTPUT_GENERATION runs and the edges (no payloads). */
  @ApiDoc({ summary: "A design version's outputs graph: snapshots, OUTPUT_GENERATION runs and edges", responses: { 200: OutputsGraph } })
  @Get("design-versions/:versionId/outputs") @AuthenticatedOnly()
  graph(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionId, "params")) p: V) {
    return this.outputs.graph(s, p.versionId);
  }

  /* ---------------------------------------------------------------- BOM */

  @ApiDoc({ summary: "Generate (or reuse) a BOM snapshot", responses: { 201: GenerateResponse, 200: GenerateResponse }, idempotent: true })
  @Post("design-versions/:versionId/bom-snapshots") @RequiresAction("output.generate.engineering")
  async generateBom(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(VersionId, "params")) p: V,
    @Body(new SchemaPipe(BomGenerateRequest, "body")) b: z.infer<typeof BomGenerateRequest>, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.outputs.generate(s, "BOM", p.versionId, idempotentRequest(req), b));
  }

  @ApiDoc({ summary: "List a version's BOM snapshots", responses: { 200: Page(SnapshotEnvelope) } })
  @Get("design-versions/:versionId/bom-snapshots") @RequiresAction("output.read.production")
  listBom(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionId, "params")) p: V, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.outputs.list(s, "BOM", p.versionId, q);
  }

  @ApiDoc({ summary: "Get a BOM snapshot with its validated payload", responses: { 200: Snapshot } })
  @Get("bom-snapshots/:snapshotId") @RequiresAction("output.read.production")
  getBom(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.get(s, "BOM", p.snapshotId);
  }

  @ApiDoc({ summary: "Detailed staleness of a BOM snapshot", responses: { 200: DetailedStaleness } })
  @Get("bom-snapshots/:snapshotId/staleness") @RequiresAction("output.read.production")
  stalenessBom(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.detailedStaleness(s, "BOM", p.snapshotId);
  }

  /* ---------------------------------------------------------------- BOQ */

  @ApiDoc({ summary: "Generate (or reuse) a BOQ snapshot", responses: { 201: GenerateResponse, 200: GenerateResponse }, idempotent: true })
  @Post("design-versions/:versionId/boq-snapshots") @RequiresAction("output.generate.engineering")
  async generateBoq(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(VersionId, "params")) p: V,
    @Body(new SchemaPipe(BoqGenerateRequest, "body")) b: z.infer<typeof BoqGenerateRequest>, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.outputs.generate(s, "BOQ", p.versionId, idempotentRequest(req), b));
  }

  @ApiDoc({ summary: "List a version's BOQ snapshots", responses: { 200: Page(SnapshotEnvelope) } })
  @Get("design-versions/:versionId/boq-snapshots") @RequiresAction("output.read.production")
  listBoq(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionId, "params")) p: V, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.outputs.list(s, "BOQ", p.versionId, q);
  }

  @ApiDoc({ summary: "Get a BOQ snapshot with its validated payload", responses: { 200: Snapshot } })
  @Get("boq-snapshots/:snapshotId") @RequiresAction("output.read.production")
  getBoq(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.get(s, "BOQ", p.snapshotId);
  }

  @ApiDoc({ summary: "Detailed staleness of a BOQ snapshot", responses: { 200: DetailedStaleness } })
  @Get("boq-snapshots/:snapshotId/staleness") @RequiresAction("output.read.production")
  stalenessBoq(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.detailedStaleness(s, "BOQ", p.snapshotId);
  }

  /* ---------------------------------------------------------------- PRICING */

  @ApiDoc({ summary: "Generate (or reuse) a Pricing snapshot", responses: { 201: GenerateResponse, 200: z.union([GenerateResponse, UnavailableResponse]) }, idempotent: true })
  @Post("design-versions/:versionId/pricing-snapshots") @RequiresAction("output.generate.commercial")
  async generatePricing(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(VersionId, "params")) p: V,
    @Body(new SchemaPipe(PricingGenerateRequest, "body")) b: z.infer<typeof PricingGenerateRequest>, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.outputs.generate(s, "PRICING", p.versionId, idempotentRequest(req), b));
  }

  @ApiDoc({ summary: "List a version's Pricing snapshots", responses: { 200: Page(SnapshotEnvelope) } })
  @Get("design-versions/:versionId/pricing-snapshots") @RequiresAction("output.read.cost")
  listPricing(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionId, "params")) p: V, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.outputs.list(s, "PRICING", p.versionId, q);
  }

  @ApiDoc({ summary: "Get a Pricing snapshot with its validated payload", responses: { 200: Snapshot } })
  @Get("pricing-snapshots/:snapshotId") @RequiresAction("output.read.cost")
  getPricing(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.get(s, "PRICING", p.snapshotId);
  }

  @ApiDoc({ summary: "Detailed staleness of a Pricing snapshot", responses: { 200: DetailedStaleness } })
  @Get("pricing-snapshots/:snapshotId/staleness") @RequiresAction("output.read.cost")
  stalenessPricing(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.detailedStaleness(s, "PRICING", p.snapshotId);
  }

  /* ---------------------------------------------------------------- QUOTATION */

  @ApiDoc({ summary: "Generate (or reuse) a Quotation snapshot", responses: { 201: GenerateResponse, 200: z.union([GenerateResponse, UnavailableResponse]) }, idempotent: true })
  @Post("design-versions/:versionId/quotation-snapshots") @RequiresAction("output.generate.commercial")
  async generateQuotation(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(VersionId, "params")) p: V,
    @Body(new SchemaPipe(QuotationGenerateRequest, "body")) b: z.infer<typeof QuotationGenerateRequest>, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.outputs.generate(s, "QUOTATION", p.versionId, idempotentRequest(req), b));
  }

  @ApiDoc({ summary: "List a version's Quotation snapshots", responses: { 200: Page(SnapshotEnvelope) } })
  @Get("design-versions/:versionId/quotation-snapshots") @RequiresAction("output.read.cost")
  listQuotation(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionId, "params")) p: V, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.outputs.list(s, "QUOTATION", p.versionId, q);
  }

  @ApiDoc({ summary: "Get a Quotation snapshot with its validated payload", responses: { 200: Snapshot } })
  @Get("quotation-snapshots/:snapshotId") @RequiresAction("output.read.cost")
  getQuotation(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.get(s, "QUOTATION", p.snapshotId);
  }

  /** A quotation snapshot's document (PDF) in manifest order (verified against the sealed file manifest). */
  @ApiDoc({ summary: "A quotation snapshot's document files (PDF) in manifest order", responses: { 200: SnapshotFiles } })
  @Get("quotation-snapshots/:snapshotId/files") @RequiresAction("output.read.cost")
  quotationFiles(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.quotationFiles(s, p.snapshotId);
  }

  @ApiDoc({ summary: "Detailed staleness of a Quotation snapshot", responses: { 200: DetailedStaleness } })
  @Get("quotation-snapshots/:snapshotId/staleness") @RequiresAction("output.read.cost")
  stalenessQuotation(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.detailedStaleness(s, "QUOTATION", p.snapshotId);
  }

  /* ---------------------------------------------------------------- DRAWING */

  @ApiDoc({ summary: "Generate (or reuse) a drawing snapshot", responses: { 201: GenerateResponse, 200: GenerateResponse }, idempotent: true })
  @Post("design-versions/:versionId/drawing-snapshots") @RequiresAction("output.generate.engineering")
  async generateDrawing(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(VersionId, "params")) p: V,
    @Body(new SchemaPipe(DrawingGenerateRequest, "body")) b: z.infer<typeof DrawingGenerateRequest>, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.outputs.generate(s, "DRAWING", p.versionId, idempotentRequest(req), b));
  }

  @ApiDoc({ summary: "List a version's drawing snapshots", responses: { 200: Page(SnapshotEnvelope) } })
  @Get("design-versions/:versionId/drawing-snapshots") @RequiresAction("output.read.production")
  listDrawing(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionId, "params")) p: V, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.outputs.list(s, "DRAWING", p.versionId, q);
  }

  @ApiDoc({ summary: "Get a drawing snapshot with its validated payload", responses: { 200: Snapshot } })
  @Get("drawing-snapshots/:snapshotId") @RequiresAction("output.read.production")
  getDrawing(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.get(s, "DRAWING", p.snapshotId);
  }

  @ApiDoc({ summary: "Detailed staleness of a drawing snapshot", responses: { 200: DetailedStaleness } })
  @Get("drawing-snapshots/:snapshotId/staleness") @RequiresAction("output.read.production")
  stalenessDrawing(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.detailedStaleness(s, "DRAWING", p.snapshotId);
  }

  /** A drawing snapshot's files in manifest order (verified against the sealed file manifest). */
  @ApiDoc({ summary: "A drawing snapshot's files in manifest order", responses: { 200: SnapshotFiles } })
  @Get("drawing-snapshots/:snapshotId/files") @RequiresAction("output.read.production")
  drawingFiles(@Scope() s: RequestScope, @Param(new SchemaPipe(SnapshotIdParam, "params")) p: S) {
    return this.outputs.files(s, p.snapshotId);
  }
}
