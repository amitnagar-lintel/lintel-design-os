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

@Controller()
export class DesignsController {
  constructor(@Inject(DesignsService) private readonly designs: DesignsService) {}

  @Post("rooms/:roomId/designs") @RequiresAction("design_version.author")
  async create(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(RoomId, "params")) p: z.infer<typeof RoomId>,
    @Body(new SchemaPipe(DesignCreate, "body")) b: DesignCreate, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.designs.create(s, p.roomId, idempotentRequest(req), b));
  }

  @Get("rooms/:roomId/designs") @AuthenticatedOnly()
  byRoom(@Scope() s: RequestScope, @Param(new SchemaPipe(RoomId, "params")) p: z.infer<typeof RoomId>, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.designs.list(s, { column: "room_id", value: p.roomId }, q);
  }

  @Get("projects/:projectId/designs") @AuthenticatedOnly()
  byProject(@Scope() s: RequestScope, @Param(new SchemaPipe(ProjectId, "params")) p: z.infer<typeof ProjectId>, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.designs.list(s, { column: "project_id", value: p.projectId }, q);
  }

  @Get("designs/:designId") @AuthenticatedOnly()
  async get(@Scope() s: RequestScope, @Param(new SchemaPipe(DesignId, "params")) p: z.infer<typeof DesignId>, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.designs.get(s, p.designId));
  }

  @Patch("designs/:designId") @RequiresAction("design_version.author")
  async update(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(DesignId, "params")) p: z.infer<typeof DesignId>,
    @Body(new SchemaPipe(DesignUpdate, "body")) b: DesignUpdate, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.designs.update(s, p.designId, ifMatch(req), b));
  }
}
