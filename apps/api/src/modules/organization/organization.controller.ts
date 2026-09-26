import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { RequestScope } from "../../common/auth/context.js";
import { AnyIdentity, AuthenticatedOnly, NoOrgContext, RequiresAction, Scope } from "../../common/auth/decorators.js";
import { ApiProblem } from "../../common/errors/api-problem.js";
import { ApiDoc } from "../../common/http/openapi.js";
import { send } from "../../common/http/request.js";
import { SchemaPipe } from "../../common/http/schema.pipe.js";
import { Page } from "../../common/http/schemas.js";
import {
  InvitationAccepted, InvitationCreate, InvitationId, InvitationListQuery, InvitationResponse, InvitationRevoke, MemberResponse, MemberUserId, MyInvitationList, OrgMemberList, RoleGrant, RoleRevoke,
} from "./organization.schemas.js";
import { OrganizationService } from "./organization.service.js";

type InvitationParams = z.infer<typeof InvitationId>;
type MemberParams = z.infer<typeof MemberUserId>;

/** Organization administration of the selected organization: invitations and member roles (internal identities). */
@Controller("org")
export class OrganizationController {
  constructor(@Inject(OrganizationService) private readonly org: OrganizationService) {}

  @ApiDoc({ summary: "Invite a named person with internal roles", responses: { 201: InvitationResponse } })
  @Post("invitations") @RequiresAction("org.members.manage")
  async invite(@Scope() s: RequestScope, @Body(new SchemaPipe(InvitationCreate, "body")) b: InvitationCreate, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.org.invite(s, b));
  }

  @ApiDoc({ summary: "List the organization's invitations", responses: { 200: Page(InvitationResponse) } })
  @Get("invitations") @RequiresAction("org.members.manage")
  invitations(@Scope() s: RequestScope, @Query(new SchemaPipe(InvitationListQuery, "query")) q: InvitationListQuery) {
    return this.org.invitations(s, q);
  }

  @ApiDoc({ summary: "Get an invitation", responses: { 200: InvitationResponse } })
  @Get("invitations/:invitationId") @RequiresAction("org.members.manage")
  async invitation(@Scope() s: RequestScope, @Param(new SchemaPipe(InvitationId, "params")) p: InvitationParams, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.org.invitation(s, p.invitationId));
  }

  @ApiDoc({ summary: "Revoke a pending invitation", responses: { 200: InvitationResponse } })
  @Post("invitations/:invitationId/revoke") @RequiresAction("org.members.manage")
  async revokeInvitation(@Scope() s: RequestScope, @Param(new SchemaPipe(InvitationId, "params")) p: InvitationParams,
    @Body(new SchemaPipe(InvitationRevoke, "body")) b: InvitationRevoke, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.org.revokeInvitation(s, p.invitationId, b));
  }

  /** The named people of the organization and their roles (who can submit, approve, issue). */
  @ApiDoc({ summary: "List the organization's members and their roles", responses: { 200: OrgMemberList } })
  @Get("members") @AuthenticatedOnly()
  members(@Scope() s: RequestScope) {
    return this.org.members(s);
  }

  @ApiDoc({ summary: "Get a member and their roles", responses: { 200: MemberResponse } })
  @Get("members/:userId") @AuthenticatedOnly()
  async member(@Scope() s: RequestScope, @Param(new SchemaPipe(MemberUserId, "params")) p: MemberParams, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.org.member(s, p.userId));
  }

  @ApiDoc({ summary: "Grant an existing member another role", responses: { 200: MemberResponse } })
  @Post("members/:userId/roles") @RequiresAction("org.members.manage")
  async grantRole(@Scope() s: RequestScope, @Param(new SchemaPipe(MemberUserId, "params")) p: MemberParams,
    @Body(new SchemaPipe(RoleGrant, "body")) b: RoleGrant, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.org.grantRole(s, p.userId, b));
  }

  @ApiDoc({ summary: "Revoke a member's role", responses: { 200: MemberResponse } })
  @Post("members/:userId/roles/revoke") @RequiresAction("org.members.manage")
  async revokeRole(@Scope() s: RequestScope, @Param(new SchemaPipe(MemberUserId, "params")) p: MemberParams,
    @Body(new SchemaPipe(RoleRevoke, "body")) b: RoleRevoke, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.org.revokeRole(s, p.userId, b));
  }
}

/**
 * The signed-in person's own invitations. No organization context: the person may not be a member of any
 * organization yet. Requires a verified email in the access token; only invitations to that email are visible.
 */
@Controller("me/invitations")
@AnyIdentity()
export class MyInvitationsController {
  constructor(@Inject(OrganizationService) private readonly org: OrganizationService) {}

  @ApiDoc({ summary: "Pending invitations addressed to the caller's verified email", responses: { 200: MyInvitationList } })
  @Get() @AuthenticatedOnly() @NoOrgContext()
  mine(@Req() req: FastifyRequest) {
    if (req.lintelPrincipal === undefined) throw new ApiProblem("INTERNAL");
    return this.org.myInvitations(req.lintelPrincipal, req.id);
  }

  @ApiDoc({ summary: "Accept an invitation: provisions the caller's identity and the invited roles", responses: { 200: InvitationAccepted } })
  @Post(":invitationId/accept") @HttpCode(200) @AuthenticatedOnly() @NoOrgContext()
  accept(@Req() req: FastifyRequest, @Param(new SchemaPipe(InvitationId, "params")) p: InvitationParams) {
    if (req.lintelPrincipal === undefined) throw new ApiProblem("INTERNAL");
    return this.org.accept(req.lintelPrincipal, req.id, p.invitationId);
  }
}
