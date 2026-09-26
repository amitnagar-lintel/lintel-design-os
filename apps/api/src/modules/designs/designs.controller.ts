import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { RequestScope } from "../../common/auth/context.js";
import { AuthenticatedOnly, RequiresAction, Scope } from "../../common/auth/decorators.js";
import { respond } from "../../common/http/respond.js";
import { idempotentRequest, ifMatch, send } from "../../common/http/request.js";
import { SchemaPipe } from "../../common/http/schema.pipe.js";
import { PageQuery } from "../../common/http/schemas.js";
import { ProjectId } from "../projects/projects.schemas.js";
import { RoomId } from "../rooms/rooms.schemas.js";
import { DesignCreate, DesignId, DesignUpdate } from "./designs.schemas.js";
import { DesignsService } from "./designs.service.js";
import { ApiDoc } from "../../common/http/openapi.js";
import { DesignResponse } from "./designs.schemas.js";
import { Page } from "../../common/http/schemas.js";

@Controller()
export class DesignsController {
  constructor(@Inject(DesignsService) private readonly designs: DesignsService) {}

  @ApiDoc({ summary: "Create a design for a room", responses: { 201: DesignResponse }, idempotent: true })
  @Post("rooms/:roomId/designs") @RequiresAction("design_version.author")
  async create(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(RoomId, "params")) p: z.infer<typeof RoomId>,
    @Body(new SchemaPipe(DesignCreate, "body")) b: DesignCreate, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.designs.create(s, p.roomId, idempotentRequest(req), b));
  }

  @ApiDoc({ summary: "List a room's designs", responses: { 200: Page(DesignResponse) } })
  @Get("rooms/:roomId/designs") @AuthenticatedOnly()
  byRoom(@Scope() s: RequestScope, @Param(new SchemaPipe(RoomId, "params")) p: z.infer<typeof RoomId>, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.designs.list(s, { column: "room_id", value: p.roomId }, q);
  }

  @ApiDoc({ summary: "List a project's designs", responses: { 200: Page(DesignResponse) } })
  @Get("projects/:projectId/designs") @AuthenticatedOnly()
  byProject(@Scope() s: RequestScope, @Param(new SchemaPipe(ProjectId, "params")) p: z.infer<typeof ProjectId>, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.designs.list(s, { column: "project_id", value: p.projectId }, q);
  }

  @ApiDoc({ summary: "Get a design", responses: { 200: DesignResponse } })
  @Get("designs/:designId") @AuthenticatedOnly()
  async get(@Scope() s: RequestScope, @Param(new SchemaPipe(DesignId, "params")) p: z.infer<typeof DesignId>, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.designs.get(s, p.designId));
  }

  @ApiDoc({ summary: "Update a design", responses: { 200: DesignResponse }, ifMatch: "required" })
  @Patch("designs/:designId") @RequiresAction("design_version.author")
  async update(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(DesignId, "params")) p: z.infer<typeof DesignId>,
    @Body(new SchemaPipe(DesignUpdate, "body")) b: DesignUpdate, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.designs.update(s, p.designId, ifMatch(req), b));
  }
}
