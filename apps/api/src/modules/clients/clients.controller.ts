import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { RequestScope } from "../../common/auth/context.js";
import { RequiresAction, Scope } from "../../common/auth/decorators.js";
import { ifMatch, send } from "../../common/http/request.js";
import { SchemaPipe } from "../../common/http/schema.pipe.js";
import { PageQuery } from "../../common/http/schemas.js";
import { ClientCreate, ClientId, ClientUpdate } from "./clients.schemas.js";
import { ClientsService } from "./clients.service.js";
import { ApiDoc } from "../../common/http/openapi.js";
import { ClientResponse } from "./clients.schemas.js";
import { Page } from "../../common/http/schemas.js";

@Controller("clients")
export class ClientsController {
  constructor(@Inject(ClientsService) private readonly clients: ClientsService) {}

  @ApiDoc({ summary: "Create a client", responses: { 201: ClientResponse } })
  @Post() @RequiresAction("client.write")
  async create(@Scope() s: RequestScope, @Body(new SchemaPipe(ClientCreate, "body")) b: ClientCreate, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.clients.create(s, b));
  }

  @ApiDoc({ summary: "List clients", responses: { 200: Page(ClientResponse) } })
  @Get() @RequiresAction("client.read")
  list(@Scope() s: RequestScope, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.clients.list(s, q);
  }

  @ApiDoc({ summary: "Get a client", responses: { 200: ClientResponse } })
  @Get(":clientId") @RequiresAction("client.read")
  async get(@Scope() s: RequestScope, @Param(new SchemaPipe(ClientId, "params")) p: z.infer<typeof ClientId>, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.clients.get(s, p.clientId));
  }

  @ApiDoc({ summary: "Update a client", responses: { 200: ClientResponse }, ifMatch: "required" })
  @Patch(":clientId") @RequiresAction("client.write")
  async update(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Param(new SchemaPipe(ClientId, "params")) p: z.infer<typeof ClientId>,
    @Body(new SchemaPipe(ClientUpdate, "body")) b: ClientUpdate, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.clients.update(s, p.clientId, ifMatch(req), b));
  }
}
