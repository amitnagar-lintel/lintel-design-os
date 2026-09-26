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
  DesignIdParam, ObjectId, ObjectInput, ObjectUpdate, OverrideCreate, OverrideParams, RunId, TransitionRequest, ValidationRequest, VersionCreate, VersionId, VersionUpdate,
} from "./design-versions.schemas.js";
import { DesignVersionsService } from "./design-versions.service.js";
import { ValidationService } from "./validation.service.js";

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

  @Post("designs/:designId/versions") @RequiresAction("design_version.author")
  async create(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(DesignIdParam, "params")) p: z.infer<typeof DesignIdParam>,
    @Body(new SchemaPipe(VersionCreate, "body")) b: VersionCreate, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.versions.create(s, p.designId, idempotentRequest(req), b));
  }

  @Get("designs/:designId/versions") @AuthenticatedOnly()
  list(@Scope() s: RequestScope, @Param(new SchemaPipe(DesignIdParam, "params")) p: z.infer<typeof DesignIdParam>, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.versions.list(s, p.designId, q);
  }

  @Get("design-versions/:versionId") @AuthenticatedOnly()
  async get(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionId, "params")) p: V, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.versions.get(s, p.versionId));
  }

  @Patch("design-versions/:versionId") @RequiresAction("design_version.author")
  async update(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(VersionId, "params")) p: V,
    @Body(new SchemaPipe(VersionUpdate, "body")) b: VersionUpdate, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.versions.update(s, p.versionId, ifMatch(req), b));
  }

  /** The single lifecycle path (design_os.transition). The required action depends on the transition. */
  @Post("design-versions/:versionId/transitions") @AuthenticatedOnly()
  async transition(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(VersionId, "params")) p: V,
    @Body(new SchemaPipe(TransitionRequest, "body")) b: TransitionRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.versions.transition(s, p.versionId, ifMatch(req), idempotentRequest(req), b));
  }

  /* ---------------------------------------------------------------- objects */

  @Get("design-versions/:versionId/objects") @AuthenticatedOnly()
  objects(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionId, "params")) p: V, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.content.list(s, p.versionId, q);
  }

  @Post("design-versions/:versionId/objects") @RequiresAction("design_version.author")
  async addObject(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(VersionId, "params")) p: V,
    @Body(new SchemaPipe(ObjectInput, "body")) b: ObjectInput, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.content.create(s, p.versionId, ifMatch(req), b));
  }

  @Get("design-objects/:objectId") @AuthenticatedOnly()
  object(@Scope() s: RequestScope, @Param(new SchemaPipe(ObjectId, "params")) p: z.infer<typeof ObjectId>) {
    return this.content.get(s, p.objectId);
  }

  @Patch("design-objects/:objectId") @RequiresAction("design_version.author")
  async updateObject(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(ObjectId, "params")) p: z.infer<typeof ObjectId>,
    @Body(new SchemaPipe(ObjectUpdate, "body")) b: ObjectUpdate, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.content.update(s, p.objectId, ifMatch(req), b));
  }

  @Delete("design-objects/:objectId") @RequiresAction("design_version.author")
  async removeObject(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(ObjectId, "params")) p: z.infer<typeof ObjectId>,
    @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.content.remove(s, p.objectId, ifMatch(req)));
  }

  /* ---------------------------------------------------------------- relationship overrides */

  @Get("design-versions/:versionId/overrides") @AuthenticatedOnly()
  overrides(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionId, "params")) p: V) {
    return this.content.overrides(s, p.versionId);
  }

  @Post("design-versions/:versionId/overrides") @RequiresAction("design_version.author")
  async addOverride(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(VersionId, "params")) p: V,
    @Body(new SchemaPipe(OverrideCreate, "body")) b: OverrideCreate, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.content.addOverride(s, p.versionId, ifMatch(req), idempotentRequest(req), b));
  }

  @Delete("design-versions/:versionId/overrides/:overrideCode") @RequiresAction("design_version.author")
  async removeOverride(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(OverrideParams, "params")) p: z.infer<typeof OverrideParams>,
    @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.content.removeOverride(s, p.versionId, p.overrideCode, ifMatch(req)));
  }

  /* ---------------------------------------------------------------- validation */

  @Post("design-versions/:versionId/validation-runs") @RequiresAction("design_version.author", "output.generate.engineering")
  async validate(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(VersionId, "params")) p: V,
    @Body(new SchemaPipe(ValidationRequest, "body")) b: z.infer<typeof ValidationRequest>, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.validation.validate(s, p.versionId, ifMatch(req), idempotentRequest(req), b));
  }

  @Get("design-versions/:versionId/validation-runs") @AuthenticatedOnly()
  runs(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionId, "params")) p: V, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.validation.list(s, p.versionId, q);
  }

  @Get("validation-runs/:runId") @AuthenticatedOnly()
  run(@Scope() s: RequestScope, @Param(new SchemaPipe(RunId, "params")) p: z.infer<typeof RunId>) {
    return this.validation.get(s, p.runId);
  }
}
