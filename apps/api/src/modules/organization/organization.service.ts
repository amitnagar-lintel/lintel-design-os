import { Inject, Injectable } from "@nestjs/common";
import type { Principal, RequestScope } from "../../common/auth/context.js";
import { Database } from "../../common/db/database.js";
import type { Tx } from "../../common/db/tx.js";
import { UnitOfWork } from "../../common/db/unit-of-work.js";
import { ApiProblem } from "../../common/errors/api-problem.js";
import { iso } from "../../common/http/format.js";
import { keysetList } from "../../common/http/list.js";
import { CursorCodec, SORTS } from "../../common/http/pagination.js";
import type { StoredResponse } from "../../common/idempotency/idempotency.service.js";
import type { InvitationRow, MemberRow } from "../../infrastructure/persistence/onboarding.repository.js";
import { onboardingRepository as repo } from "../../infrastructure/persistence/onboarding.repository.js";
import type {
  InternalRole, InvitationAccepted, InvitationCreate, InvitationListQuery, InvitationResponse, InvitationRevoke, MemberResponse, MyInvitationList, OrgMemberList, RoleGrant, RoleRevoke,
} from "./organization.schemas.js";

export function toInvitation(r: InvitationRow): InvitationResponse {
  return {
    id: r.id, orgId: r.org_id, email: r.email, displayName: r.display_name, roles: r.roles as InternalRole[], status: r.status, expired: r.expired,
    invitedBy: r.invited_by, createdAt: iso(r.created_at), expiresAt: iso(r.expires_at),
    acceptedBy: r.accepted_by, acceptedAt: r.accepted_at === null ? null : iso(r.accepted_at),
    revokedBy: r.revoked_by, revokedAt: r.revoked_at === null ? null : iso(r.revoked_at),
  };
}

export function toMember(r: MemberRow): MemberResponse {
  return {
    userId: r.user_id, email: r.email, displayName: r.display_name, identityKind: r.identity_kind, status: r.user_status,
    roles: r.memberships.filter((m) => m.status === "ACTIVE").map((m) => m.role as MemberResponse["roles"][number]).sort(),
    memberships: r.memberships.map((m) => ({ role: m.role as MemberResponse["roles"][number], status: m.status, grantedBy: m.granted_by, grantedAt: iso(m.granted_at) })),
  };
}

/**
 * Organization onboarding (M6 G4). Administrators (org.members.manage) invite named people with INTERNAL roles, and
 * grant or revoke roles of existing members. The invited person, signed in through Supabase Auth with a verified email,
 * accepts: the API provisions their own identity and exactly the invited memberships in one transaction. The database
 * (0019 RLS) is the boundary for every step; roles and role → action grants stay the existing RBAC.
 */
@Injectable()
export class OrganizationService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(Database) private readonly db: Database,
    @Inject(CursorCodec) private readonly cursors: CursorCodec,
  ) {}

  // ---------------------------------------------------------------- administrators (org context)

  invite(scope: RequestScope, b: InvitationCreate): Promise<StoredResponse> {
    return this.uow.run(scope, { action: "org.members.manage", reason: `invite ${b.email}` }, async (tx) => {
      const open = await repo.pendingFor(tx, b.email);
      if (open !== null && !open.expired) throw new ApiProblem("DUPLICATE_RESOURCE", "a PENDING invitation for this email already exists");
      // An expired invitation can never be accepted; it is closed (audited) so the person can be invited again.
      if (open !== null) await repo.revokeInvitation(tx, open.id);
      const row = await repo.insertInvitation(tx, { org_id: scope.org.orgId, email: b.email, display_name: b.displayName, roles: b.roles });
      if (row === null) throw new ApiProblem("INTERNAL");
      return { status: 201, body: toInvitation(row), headers: { location: `/api/v1/org/invitations/${row.id}` } };
    });
  }

  invitations(scope: RequestScope, q: InvitationListQuery) {
    return this.uow.run(scope, { action: "org.members.manage", readOnly: true }, (tx) => keysetList(tx, {
      codec: this.cursors, collection: `org-invitations:${q.status ?? "ALL"}`, orgId: scope.org.orgId, sort: SORTS.newestFirst, query: q, firstParam: 2,
      fetch: (t, page, params) => repo.listInvitations(t, q.status ?? null, page, params), key: (r) => r.created_at, id: (r) => r.id, map: toInvitation,
    }));
  }

  invitation(scope: RequestScope, id: string): Promise<StoredResponse> {
    return this.uow.run(scope, { action: "org.members.manage", readOnly: true }, async (tx) => {
      const row = await repo.invitation(tx, id);
      if (row?.org_id !== scope.org.orgId) throw new ApiProblem("NOT_FOUND");
      return { status: 200, body: toInvitation(row) };
    });
  }

  revokeInvitation(scope: RequestScope, id: string, b: InvitationRevoke): Promise<StoredResponse> {
    return this.uow.run(scope, { action: "org.members.manage", reason: b.reason }, async (tx) => {
      const row = await repo.invitation(tx, id);
      if (row?.org_id !== scope.org.orgId) throw new ApiProblem("NOT_FOUND");
      if (row.status !== "PENDING") throw new ApiProblem("INVITATION_INVALID", `the invitation is ${row.status}`);
      const next = await repo.revokeInvitation(tx, id);
      if (next === null) throw new ApiProblem("INVITATION_INVALID");
      return { status: 200, body: toInvitation(next) };
    });
  }

  /** Every person with a membership in the organization (any status), with their current roles. Internal members only (RLS). */
  members(scope: RequestScope): Promise<OrgMemberList> {
    return this.uow.run(scope, { readOnly: true }, async (tx) => ({ items: (await repo.members(tx)).map(toMember) }));
  }

  member(scope: RequestScope, userId: string): Promise<StoredResponse> {
    return this.uow.run(scope, { readOnly: true }, async (tx) => ({ status: 200, body: toMember(await this.existingMember(tx, userId)) }));
  }

  /** Another role for an existing member. New people are only ever added through an invitation. */
  grantRole(scope: RequestScope, userId: string, b: RoleGrant): Promise<StoredResponse> {
    return this.uow.run(scope, { action: "org.members.manage", reason: b.reason }, async (tx) => {
      await this.existingMember(tx, userId);
      const current = await repo.membership(tx, userId, b.role);
      if (current?.status === "ACTIVE") throw new ApiProblem("DUPLICATE_RESOURCE", `the member already holds ${b.role}`);
      if (current === null) await repo.grantRole(tx, scope.org.orgId, userId, b.role);
      else await repo.reactivateRole(tx, userId, b.role);
      return { status: 200, body: toMember(await this.existingMember(tx, userId)) };
    });
  }

  revokeRole(scope: RequestScope, userId: string, b: RoleRevoke): Promise<StoredResponse> {
    return this.uow.run(scope, { action: "org.members.manage", reason: b.reason }, async (tx) => {
      await this.existingMember(tx, userId);
      if (b.role === "ADMIN") {
        const admins = await repo.activeAdmins(tx);
        if (admins.length === 1 && admins[0] === userId) throw new ApiProblem("LAST_ADMIN");
      }
      const current = await repo.membership(tx, userId, b.role);
      if (current?.status !== "ACTIVE") throw new ApiProblem("NOT_FOUND", `the member does not hold ${b.role}`);
      await repo.revokeRole(tx, userId, b.role);
      return { status: 200, body: toMember(await this.existingMember(tx, userId)) };
    });
  }

  private async existingMember(tx: Tx, userId: string): Promise<MemberRow> {
    const m = await repo.member(tx, userId);
    if (m === null) throw new ApiProblem("NOT_FOUND");
    return m;
  }

  // ---------------------------------------------------------------- the invited person (no org context yet)

  myInvitations(principal: Principal, requestId: string): Promise<MyInvitationList> {
    verifiedEmail(principal);
    return this.db.transaction({ claims: { sub: principal.userId }, requestId, readOnly: true }, async (tx) => ({
      items: (await repo.myInvitations(tx)).map((r) => ({ id: r.id, orgId: r.org_id, displayName: r.display_name, roles: r.roles as InternalRole[], expiresAt: iso(r.expires_at) })),
    }));
  }

  /**
   * Accept an invitation addressed to the caller: provision their own INTERNAL identity (named by the administrator)
   * when it does not exist yet, add exactly the invited roles, and close the invitation — all or nothing. Accepting an
   * invitation the caller already accepted returns the same result.
   */
  accept(principal: Principal, requestId: string, id: string): Promise<InvitationAccepted> {
    const email = verifiedEmail(principal);
    return this.db.transaction({ claims: { sub: principal.userId }, requestId, reason: "invitation accepted" }, async (tx) => {
      const seen = await repo.invitation(tx, id);
      if (seen === null) throw new ApiProblem("NOT_FOUND");
      if (seen.status === "ACCEPTED" && seen.accepted_by === principal.userId) return accepted(seen, principal.userId);
      if (seen.status !== "PENDING" || seen.expired) throw new ApiProblem("INVITATION_INVALID", seen.expired ? "the invitation has expired" : `the invitation is ${seen.status}`);
      // The token's verified email and the Supabase Auth record must both be the invited address.
      if (seen.email !== email || (await repo.authEmail(tx)) !== seen.email) throw new ApiProblem("NOT_FOUND");
      const inv = await repo.invitation(tx, id, true);
      if (inv?.status !== "PENDING") throw new ApiProblem("INVITATION_INVALID", "the invitation changed; retry");

      const user = await repo.ownUser(tx);
      if (user === null) await repo.provisionOwnUser(tx, inv.email, inv.display_name);
      else if (user.identity_kind !== "INTERNAL" || user.status !== "ACTIVE") throw new ApiProblem("MEMBERSHIP_RULE_VIOLATION", "only an active internal identity can accept an invitation");

      const existing = new Map((await repo.ownMemberships(tx, inv.org_id)).map((m) => [m.role, m.status]));
      for (const role of inv.roles) {
        const status = existing.get(role);
        if (status === undefined) await repo.insertOwnMembership(tx, inv.org_id, role, inv.invited_by);
        else if (status === "REVOKED") await repo.reactivateOwnMembership(tx, inv.org_id, role, inv.invited_by);
      }
      const done = await repo.acceptInvitation(tx, id);
      if (done === null) throw new ApiProblem("INVITATION_INVALID", "the invitation changed; retry");
      return accepted(done, principal.userId);
    });
  }
}

function verifiedEmail(principal: Principal): string {
  if (principal.email === null || !principal.emailVerified) throw new ApiProblem("EMAIL_NOT_VERIFIED");
  return principal.email.trim().toLowerCase();
}

function accepted(r: InvitationRow, userId: string): InvitationAccepted {
  return { invitationId: r.id, orgId: r.org_id, userId, displayName: r.display_name, roles: r.roles as InternalRole[], acceptedAt: iso(r.accepted_at ?? r.created_at) };
}
