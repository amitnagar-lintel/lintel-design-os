import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { RequestScope } from "../../common/auth/context.js";
import { AuthenticatedOnly, RequiresAction, Scope } from "../../common/auth/decorators.js";
import { ifMatch, send } from "../../common/http/request.js";
import { SchemaPipe } from "../../common/http/schema.pipe.js";
import { PageQuery } from "../../common/http/schemas.js";
import { MemberAssign, MemberRevoke, ProjectCreate, ProjectId, ProjectUpdate } from "./projects.schemas.js";
import { ProjectsService } from "./projects.service.js";

type Id = z.infer<typeof ProjectId>;

@Controller("projects")
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Post() @RequiresAction("project.write")
  async create(@Scope() s: RequestScope, @Body(new SchemaPipe(ProjectCreate, "body")) b: ProjectCreate, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.projects.create(s, b));
  }

  /** Projects visible to the caller (RLS: all with project.read_all, otherwise assigned ones). */
  @Get() @AuthenticatedOnly()
  list(@Scope() s: RequestScope, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.projects.list(s, q);
  }

  @Get(":projectId") @AuthenticatedOnly()
  async get(@Scope() s: RequestScope, @Param(new SchemaPipe(ProjectId, "params")) p: Id, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.projects.get(s, p.projectId));
  }

  @Patch(":projectId") @RequiresAction("project.write")
  async update(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(ProjectId, "params")) p: Id,
    @Body(new SchemaPipe(ProjectUpdate, "body")) b: ProjectUpdate, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.projects.update(s, p.projectId, ifMatch(req), b));
  }

  @Get(":projectId/members") @AuthenticatedOnly()
  members(@Scope() s: RequestScope, @Param(new SchemaPipe(ProjectId, "params")) p: Id) {
    return this.projects.members(s, p.projectId);
  }

  @Post(":projectId/members") @RequiresAction("project_members.assign")
  async assign(@Scope() s: RequestScope, @Param(new SchemaPipe(ProjectId, "params")) p: Id, @Body(new SchemaPipe(MemberAssign, "body")) b: MemberAssign,
    @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.projects.assign(s, p.projectId, b));
  }

  @Post(":projectId/members/revoke") @RequiresAction("project_members.assign")
  async revoke(@Scope() s: RequestScope, @Param(new SchemaPipe(ProjectId, "params")) p: Id, @Body(new SchemaPipe(MemberRevoke, "body")) b: MemberRevoke,
    @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.projects.revoke(s, p.projectId, b));
  }
}
