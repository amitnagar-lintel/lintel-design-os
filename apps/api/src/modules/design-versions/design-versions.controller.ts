import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { RequestScope } from "../../common/auth/context.js";
import { AuthenticatedOnly, RequiresAction, Scope } from "../../common/auth/decorators.js";
import { respond } from "../../common/http/respond.js";
import { idempotentRequest, ifMatch, send } from "../../common/http/request.js";
import { SchemaPipe } from "../../common/http/schema.pipe.js";
import { PageQuery } from "../../common/http/schemas.js";
import { DesignObjectsService } from "./design-objects.service.js";
import {
  DesignIdParam, ObjectId, ObjectInput, ObjectUpdate, OverrideCreate, OverrideParams, RunId, TransitionRequest, ValidationRequest, ValidationRunQuery, VersionCreate, VersionId, VersionUpdate,
} from "./design-versions.schemas.js";
import { DesignVersionsService } from "./design-versions.service.js";
import { ValidationService } from "./validation.service.js";
import { ApiDoc } from "../../common/http/openapi.js";
import { ObjectDeleted, ObjectMutation, ObjectResponse, OverrideDeleted, OverrideList, OverrideMutation, ValidationRunResponse, VersionResponse } from "./design-versions.schemas.js";
import { Page } from "../../common/http/schemas.js";

type V = z.infer<typeof VersionId>;

/** DesignVersions, their draft content, lifecycle transitions and validation runs. HTTP only. */
@Controller()
export class DesignVersionsController {
  constructor(
    @Inject(DesignVersionsService) private readonly versions: DesignVersionsService,
    @Inject(DesignObjectsService) private readonly content: DesignObjectsService,
    @Inject(ValidationService) private readonly validation: ValidationService,
  ) {}

  /* ---------------------------------------------------------------- versions */

  @ApiDoc({ summary: "Create a design version (exact pins)", responses: { 201: VersionResponse }, idempotent: true })
  @Post("designs/:designId/versions") @RequiresAction("design_version.author")
  async create(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(DesignIdParam, "params")) p: z.infer<typeof DesignIdParam>,
    @Body(new SchemaPipe(VersionCreate, "body")) b: VersionCreate, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.versions.create(s, p.designId, idempotentRequest(req), b));
  }

  @ApiDoc({ summary: "List a design's versions", responses: { 200: Page(VersionResponse) } })
  @Get("designs/:designId/versions") @AuthenticatedOnly()
  list(@Scope() s: RequestScope, @Param(new SchemaPipe(DesignIdParam, "params")) p: z.infer<typeof DesignIdParam>, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.versions.list(s, p.designId, q);
  }

  @ApiDoc({ summary: "Get a design version", responses: { 200: VersionResponse } })
  @Get("design-versions/:versionId") @AuthenticatedOnly()
  async get(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionId, "params")) p: V, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.versions.get(s, p.versionId));
  }

  @ApiDoc({ summary: "Update a DRAFT version's pins, survey revision or metadata", responses: { 200: VersionResponse }, ifMatch: "required" })
  @Patch("design-versions/:versionId") @RequiresAction("design_version.author")
  async update(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(VersionId, "params")) p: V,
    @Body(new SchemaPipe(VersionUpdate, "body")) b: VersionUpdate, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.versions.update(s, p.versionId, ifMatch(req), b));
  }

  /** The single lifecycle path (design_os.transition). The required action depends on the transition. */
  @ApiDoc({ summary: "Lifecycle transition (SUBMIT, REQUEST_CHANGES, APPROVE, LOCK)", responses: { 200: VersionResponse }, idempotent: true, ifMatch: "required" })
  @Post("design-versions/:versionId/transitions") @AuthenticatedOnly()
  async transition(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(VersionId, "params")) p: V,
    @Body(new SchemaPipe(TransitionRequest, "body")) b: TransitionRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.versions.transition(s, p.versionId, ifMatch(req), idempotentRequest(req), b));
  }

  /* ---------------------------------------------------------------- objects */

  @ApiDoc({ summary: "List a version's design objects", responses: { 200: Page(ObjectResponse) } })
  @Get("design-versions/:versionId/objects") @AuthenticatedOnly()
  objects(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionId, "params")) p: V, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.content.list(s, p.versionId, q);
  }

  @ApiDoc({ summary: "Add a design object to a DRAFT", responses: { 201: ObjectMutation }, ifMatch: "required" })
  @Post("design-versions/:versionId/objects") @RequiresAction("design_version.author")
  async addObject(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(VersionId, "params")) p: V,
    @Body(new SchemaPipe(ObjectInput, "body")) b: ObjectInput, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.content.create(s, p.versionId, ifMatch(req), b));
  }

  @ApiDoc({ summary: "Get a design object", responses: { 200: ObjectResponse } })
  @Get("design-objects/:objectId") @AuthenticatedOnly()
  object(@Scope() s: RequestScope, @Param(new SchemaPipe(ObjectId, "params")) p: z.infer<typeof ObjectId>) {
    return this.content.get(s, p.objectId);
  }

  @ApiDoc({ summary: "Update a design object of a DRAFT", responses: { 200: ObjectMutation }, ifMatch: "required" })
  @Patch("design-objects/:objectId") @RequiresAction("design_version.author")
  async updateObject(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(ObjectId, "params")) p: z.infer<typeof ObjectId>,
    @Body(new SchemaPipe(ObjectUpdate, "body")) b: ObjectUpdate, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.content.update(s, p.objectId, ifMatch(req), b));
  }

  @ApiDoc({ summary: "Remove a design object from a DRAFT", responses: { 200: ObjectDeleted }, ifMatch: "required" })
  @Delete("design-objects/:objectId") @RequiresAction("design_version.author")
  async removeObject(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(ObjectId, "params")) p: z.infer<typeof ObjectId>,
    @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.content.remove(s, p.objectId, ifMatch(req)));
  }

  /* ---------------------------------------------------------------- relationship overrides */

  @ApiDoc({ summary: "List a version's relationship overrides", responses: { 200: OverrideList } })
  @Get("design-versions/:versionId/overrides") @AuthenticatedOnly()
  overrides(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionId, "params")) p: V) {
    return this.content.overrides(s, p.versionId);
  }

  @ApiDoc({ summary: "Add a relationship override to a DRAFT", responses: { 201: OverrideMutation }, idempotent: true, ifMatch: "required" })
  @Post("design-versions/:versionId/overrides") @RequiresAction("design_version.author")
  async addOverride(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(VersionId, "params")) p: V,
    @Body(new SchemaPipe(OverrideCreate, "body")) b: OverrideCreate, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.content.addOverride(s, p.versionId, ifMatch(req), idempotentRequest(req), b));
  }

  @ApiDoc({ summary: "Remove a relationship override from a DRAFT", responses: { 200: OverrideDeleted }, ifMatch: "required" })
  @Delete("design-versions/:versionId/overrides/:overrideCode") @RequiresAction("design_version.author")
  async removeOverride(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(OverrideParams, "params")) p: z.infer<typeof OverrideParams>,
    @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.content.removeOverride(s, p.versionId, p.overrideCode, ifMatch(req)));
  }

  /* ---------------------------------------------------------------- validation */

  @ApiDoc({ summary: "Record an APPROVAL validation run (the engine decides)", responses: { 201: ValidationRunResponse }, idempotent: true, ifMatch: "optional" })
  @Post("design-versions/:versionId/validation-runs") @RequiresAction("design_version.author", "output.generate.engineering")
  async validate(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(VersionId, "params")) p: V,
    @Body(new SchemaPipe(ValidationRequest, "body")) b: z.infer<typeof ValidationRequest>, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.validation.validate(s, p.versionId, ifMatch(req), idempotentRequest(req), b));
  }

  @ApiDoc({ summary: "List a version's validation runs (optionally by purpose)", responses: { 200: Page(ValidationRunResponse) } })
  @Get("design-versions/:versionId/validation-runs") @AuthenticatedOnly()
  runs(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionId, "params")) p: V, @Query(new SchemaPipe(ValidationRunQuery, "query")) q: ValidationRunQuery) {
    return this.validation.list(s, p.versionId, q);
  }

  @ApiDoc({ summary: "Get a validation run", responses: { 200: ValidationRunResponse } })
  @Get("validation-runs/:runId") @AuthenticatedOnly()
  run(@Scope() s: RequestScope, @Param(new SchemaPipe(RunId, "params")) p: z.infer<typeof RunId>) {
    return this.validation.get(s, p.runId);
  }
}
