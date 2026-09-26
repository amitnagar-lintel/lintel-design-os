import { z } from "zod";
import { IdentityKind, PageQuery, Reason, Uuid } from "../../common/http/schemas.js";

/** The existing RBAC roles (design_os.design_os_role). CLIENT identities are onboarded as client contacts, never here. */
export const OrgRole = z.enum(["ADMIN", "DESIGNER", "DESIGN_HEAD", "SALES", "COSTING", "FINANCE", "PROCUREMENT", "PRODUCTION", "SITE_ENGINEER", "CLIENT"]);
export const InternalRole = OrgRole.exclude(["CLIENT"]);
export type InternalRole = z.infer<typeof InternalRole>;

const Email = z.string().trim().toLowerCase().pipe(z.email().max(320));
/** The person's name as it appears on approvals, title blocks and the audit trail. */
const DisplayName = z.string().trim().min(1).max(200);

export const InvitationCreate = z.strictObject({
  email: Email,
  displayName: DisplayName,
  roles: z.array(InternalRole).min(1).max(9).refine((r) => new Set(r).size === r.length, "each role at most once"),
});
export type InvitationCreate = z.infer<typeof InvitationCreate>;
export const InvitationRevoke = z.strictObject({ reason: Reason });
export type InvitationRevoke = z.infer<typeof InvitationRevoke>;
export const InvitationId = z.strictObject({ invitationId: Uuid });
export const InvitationListQuery = PageQuery.extend({ status: z.enum(["PENDING", "ACCEPTED", "REVOKED"]).optional() }).strict();
export type InvitationListQuery = z.infer<typeof InvitationListQuery>;

export const InvitationResponse = z.strictObject({
  id: Uuid,
  orgId: Uuid,
  email: z.string(),
  displayName: z.string(),
  roles: z.array(InternalRole),
  status: z.enum(["PENDING", "ACCEPTED", "REVOKED"]),
  /** PENDING but past its expiry: it can no longer be accepted (revoke it and invite again). */
  expired: z.boolean(),
  invitedBy: Uuid.nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  acceptedBy: Uuid.nullable(),
  acceptedAt: z.string().nullable(),
  revokedBy: Uuid.nullable(),
  revokedAt: z.string().nullable(),
});
export type InvitationResponse = z.infer<typeof InvitationResponse>;

export const MyInvitation = z.strictObject({ id: Uuid, orgId: Uuid, displayName: z.string(), roles: z.array(InternalRole), expiresAt: z.string() });
export const MyInvitationList = z.strictObject({ items: z.array(MyInvitation) });
export type MyInvitationList = z.infer<typeof MyInvitationList>;
export const InvitationAccepted = z.strictObject({ invitationId: Uuid, orgId: Uuid, userId: Uuid, displayName: z.string(), roles: z.array(InternalRole), acceptedAt: z.string() });
export type InvitationAccepted = z.infer<typeof InvitationAccepted>;

export const Membership = z.strictObject({ role: OrgRole, status: z.enum(["ACTIVE", "REVOKED"]), grantedBy: Uuid.nullable(), grantedAt: z.string() });
export const MemberResponse = z.strictObject({
  userId: Uuid,
  email: z.string(),
  displayName: z.string(),
  identityKind: IdentityKind,
  status: z.enum(["ACTIVE", "DISABLED"]),
  /** Roles currently held (ACTIVE memberships), code-point order. */
  roles: z.array(OrgRole),
  memberships: z.array(Membership),
});
export type MemberResponse = z.infer<typeof MemberResponse>;
export const OrgMemberList = z.strictObject({ items: z.array(MemberResponse) });
export type OrgMemberList = z.infer<typeof OrgMemberList>;
export const MemberUserId = z.strictObject({ userId: Uuid });
export const RoleGrant = z.strictObject({ role: InternalRole, reason: Reason });
export type RoleGrant = z.infer<typeof RoleGrant>;
export const RoleRevoke = z.strictObject({ role: InternalRole, reason: Reason });
export type RoleRevoke = z.infer<typeof RoleRevoke>;
