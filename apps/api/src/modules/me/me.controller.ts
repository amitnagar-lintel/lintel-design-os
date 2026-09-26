import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { RequestScope } from "../../common/auth/context.js";
import { AnyIdentity, AuthenticatedOnly, NoOrgContext, Scope } from "../../common/auth/decorators.js";
import { ApiProblem } from "../../common/errors/api-problem.js";
import { MeService } from "./me.service.js";
import { ApiDoc } from "../../common/http/openapi.js";
import { MeResponse, MyOrganizationsResponse } from "./me.schemas.js";

/** The caller: identity, verified org context and effective permissions (for UI capability flags). */
@Controller("me")
@AnyIdentity()
export class MeController {
  constructor(@Inject(MeService) private readonly service: MeService) {}

  @ApiDoc({ summary: "The caller, the selected organization and effective permissions", responses: { 200: MeResponse } })
  @Get()
  @AuthenticatedOnly()
  me(@Scope() scope: RequestScope): MeResponse {
    return this.service.me(scope);
  }

  /** The organizations the caller may select with X-Org (own ACTIVE memberships only). */
  @ApiDoc({ summary: "The organizations the caller may select", responses: { 200: MyOrganizationsResponse } })
  @Get("organizations")
  @AuthenticatedOnly()
  @NoOrgContext()
  organizations(@Req() req: FastifyRequest): Promise<MyOrganizationsResponse> {
    if (req.lintelPrincipal === undefined) throw new ApiProblem("INTERNAL");
    return this.service.organizations(req.lintelPrincipal, req.id);
  }
}
