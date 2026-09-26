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
import { RevisionId, RoomCreate, RoomId, RoomUpdate, SurveyInput } from "./rooms.schemas.js";
import { RoomsService } from "./rooms.service.js";
import { ApiDoc } from "../../common/http/openapi.js";
import { RevisionResponse, RoomResponse } from "./rooms.schemas.js";
import { Page } from "../../common/http/schemas.js";

@Controller()
export class RoomsController {
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService) {}

  @ApiDoc({ summary: "Create a room with its initial survey", responses: { 201: RoomResponse }, idempotent: true })
  @Post("projects/:projectId/rooms") @RequiresAction("room.survey.write")
  async create(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(ProjectId, "params")) p: z.infer<typeof ProjectId>,
    @Body(new SchemaPipe(RoomCreate, "body")) b: RoomCreate, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.rooms.create(s, p.projectId, idempotentRequest(req), b));
  }

  @ApiDoc({ summary: "List a project's rooms", responses: { 200: Page(RoomResponse) } })
  @Get("projects/:projectId/rooms") @AuthenticatedOnly()
  list(@Scope() s: RequestScope, @Param(new SchemaPipe(ProjectId, "params")) p: z.infer<typeof ProjectId>, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.rooms.list(s, p.projectId, q);
  }

  @ApiDoc({ summary: "Get a room", responses: { 200: RoomResponse } })
  @Get("rooms/:roomId") @AuthenticatedOnly()
  async get(@Scope() s: RequestScope, @Param(new SchemaPipe(RoomId, "params")) p: z.infer<typeof RoomId>, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.rooms.get(s, p.roomId));
  }

  @ApiDoc({ summary: "Rename a room", responses: { 200: RoomResponse }, ifMatch: "required" })
  @Patch("rooms/:roomId") @RequiresAction("room.survey.write")
  async update(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(RoomId, "params")) p: z.infer<typeof RoomId>,
    @Body(new SchemaPipe(RoomUpdate, "body")) b: RoomUpdate, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.rooms.update(s, p.roomId, ifMatch(req), b));
  }

  @ApiDoc({ summary: "Record a new survey revision", responses: { 201: RevisionResponse }, idempotent: true })
  @Post("rooms/:roomId/revisions") @RequiresAction("room.survey.write")
  async revise(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(RoomId, "params")) p: z.infer<typeof RoomId>,
    @Body(new SchemaPipe(SurveyInput, "body")) b: SurveyInput, @Res({ passthrough: true }) reply: FastifyReply) {
    return respond(reply, await this.rooms.revise(s, p.roomId, idempotentRequest(req), b));
  }

  @ApiDoc({ summary: "List a room's survey revisions", responses: { 200: Page(RevisionResponse) } })
  @Get("rooms/:roomId/revisions") @AuthenticatedOnly()
  revisions(@Scope() s: RequestScope, @Param(new SchemaPipe(RoomId, "params")) p: z.infer<typeof RoomId>, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.rooms.revisions(s, p.roomId, q);
  }

  @ApiDoc({ summary: "Get a survey revision", responses: { 200: RevisionResponse } })
  @Get("room-revisions/:revisionId") @AuthenticatedOnly()
  revision(@Scope() s: RequestScope, @Param(new SchemaPipe(RevisionId, "params")) p: z.infer<typeof RevisionId>) {
    return this.rooms.revision(s, p.revisionId);
  }
}
