import type { Tx } from "../../common/db/tx.js";
import type { Keyset } from "./json.js";
import { jsonRow, jsonRows } from "./json.js";

export interface InvitationRow {
  readonly id: string;
  readonly org_id: string;
  readonly email: string;
  readonly display_name: string;
  readonly roles: readonly string[];
  readonly status: "PENDING" | "ACCEPTED" | "REVOKED";
  readonly invited_by: string | null;
  readonly created_at: string;
  readonly expires_at: string;
  readonly accepted_by: string | null;
  readonly accepted_at: string | null;
  readonly revoked_by: string | null;
  readonly revoked_at: string | null;
  readonly expired: boolean;
}

export interface MembershipRow {
  readonly user_id: string;
  readonly role: string;
  readonly status: "ACTIVE" | "REVOKED";
  readonly granted_by: string | null;
  readonly granted_at: string;
}

export interface MemberRow {
  readonly user_id: string;
  readonly email: string;
  readonly display_name: string;
  readonly identity_kind: "INTERNAL" | "CLIENT";
  readonly user_status: "ACTIVE" | "DISABLED";
  readonly memberships: readonly MembershipRow[];
}

const INVITATION = `id, org_id, email, display_name, roles::text[] AS roles, status, invited_by, created_at, expires_at,
  accepted_by, accepted_at, revoked_by, revoked_at, (status = 'PENDING' AND expires_at <= now()) AS expired`;

const MEMBER = `SELECT u.id AS user_id, u.email, u.display_name, u.identity_kind, u.status AS user_status,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'status', m.status, 'granted_by', m.granted_by, 'granted_at', m.granted_at) ORDER BY m.role), '[]'::jsonb)
       FROM design_os.org_membership m WHERE m.org_id = design_os.current_org_id() AND m.user_id = u.id) AS memberships
  FROM design_os.app_user u
  WHERE EXISTS (SELECT 1 FROM design_os.org_membership m WHERE m.org_id = design_os.current_org_id() AND m.user_id = u.id)`;

/** SQL for invitations, self-provisioning and organization memberships. RLS (0010, 0019) bounds every statement. */
export const onboardingRepository = {
  insertInvitation(tx: Tx, r: { org_id: string; email: string; display_name: string; roles: readonly string[] }): Promise<InvitationRow | null> {
    return jsonRow<InvitationRow>(tx, `INSERT INTO design_os.org_invitation (org_id, email, display_name, roles, invited_by)
      VALUES ($1, $2, $3, $4::design_os.design_os_role[], design_os.current_user_id()) RETURNING ${INVITATION}`, [r.org_id, r.email, r.display_name, r.roles]);
  },
  invitation(tx: Tx, id: string, lock = false): Promise<InvitationRow | null> {
    return jsonRow<InvitationRow>(tx, `SELECT ${INVITATION} FROM design_os.org_invitation WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  },
  pendingFor(tx: Tx, email: string): Promise<InvitationRow | null> {
    return jsonRow<InvitationRow>(tx, `SELECT ${INVITATION} FROM design_os.org_invitation WHERE org_id = design_os.current_org_id() AND email = $1 AND status = 'PENDING' FOR UPDATE`, [email]);
  },
  listInvitations(tx: Tx, status: string | null, page: Keyset, params: readonly unknown[]): Promise<InvitationRow[]> {
    return jsonRows<InvitationRow>(tx, `SELECT ${INVITATION} FROM design_os.org_invitation
      WHERE org_id = design_os.current_org_id() AND ($1::text IS NULL OR status = $1) AND ${page.where} ${page.orderLimit}`, [status, ...params]);
  },
  /** PENDING, unexpired invitations addressed to the caller's own Supabase Auth email (any organization). */
  myInvitations(tx: Tx): Promise<InvitationRow[]> {
    return jsonRows<InvitationRow>(tx, `SELECT ${INVITATION} FROM design_os.org_invitation
      WHERE email = design_os.current_auth_email() AND status = 'PENDING' AND expires_at > now() ORDER BY created_at, id`, []);
  },
  revokeInvitation(tx: Tx, id: string): Promise<InvitationRow | null> {
    return jsonRow<InvitationRow>(tx, `UPDATE design_os.org_invitation SET status = 'REVOKED', revoked_by = design_os.current_user_id(), revoked_at = now()
      WHERE id = $1 AND status = 'PENDING' RETURNING ${INVITATION}`, [id]);
  },
  acceptInvitation(tx: Tx, id: string): Promise<InvitationRow | null> {
    return jsonRow<InvitationRow>(tx, `UPDATE design_os.org_invitation SET status = 'ACCEPTED', accepted_by = design_os.current_user_id(), accepted_at = now()
      WHERE id = $1 AND status = 'PENDING' RETURNING ${INVITATION}`, [id]);
  },

  async authEmail(tx: Tx): Promise<string | null> {
    return (await tx.one<{ email: string | null }>("SELECT design_os.current_auth_email() AS email")).email;
  },
  ownUser(tx: Tx): Promise<{ id: string; identity_kind: "INTERNAL" | "CLIENT"; status: "ACTIVE" | "DISABLED" } | null> {
    return jsonRow(tx, "SELECT id, identity_kind, status FROM design_os.app_user WHERE id = design_os.current_user_id()", []);
  },
  async provisionOwnUser(tx: Tx, email: string, displayName: string): Promise<void> {
    await tx.query("INSERT INTO design_os.app_user (id, email, display_name, identity_kind) VALUES (design_os.current_user_id(), $1, $2, 'INTERNAL')", [email, displayName]);
  },
  /** The caller's own membership rows in an organization they are being onboarded to (0019 read policy). */
  ownMemberships(tx: Tx, orgId: string): Promise<MembershipRow[]> {
    return jsonRows<MembershipRow>(tx, "SELECT user_id, role, status, granted_by, granted_at FROM design_os.org_membership WHERE org_id = $1 AND user_id = design_os.current_user_id()", [orgId]);
  },
  async insertOwnMembership(tx: Tx, orgId: string, role: string, grantedBy: string | null): Promise<void> {
    await tx.query("INSERT INTO design_os.org_membership (org_id, user_id, role, granted_by) VALUES ($1, design_os.current_user_id(), $2, $3)", [orgId, role, grantedBy]);
  },
  async reactivateOwnMembership(tx: Tx, orgId: string, role: string, grantedBy: string | null): Promise<void> {
    await tx.query(`UPDATE design_os.org_membership SET status = 'ACTIVE', granted_by = $3, granted_at = now()
      WHERE org_id = $1 AND user_id = design_os.current_user_id() AND role = $2 AND status = 'REVOKED'`, [orgId, role, grantedBy]);
  },

  members(tx: Tx): Promise<MemberRow[]> {
    return jsonRows<MemberRow>(tx, `${MEMBER} ORDER BY u.display_name, u.id`, []);
  },
  member(tx: Tx, userId: string): Promise<MemberRow | null> {
    return jsonRow<MemberRow>(tx, `${MEMBER} AND u.id = $1`, [userId]);
  },
  membership(tx: Tx, userId: string, role: string): Promise<MembershipRow | null> {
    return jsonRow<MembershipRow>(tx, `SELECT user_id, role, status, granted_by, granted_at FROM design_os.org_membership
      WHERE org_id = design_os.current_org_id() AND user_id = $1 AND role = $2 FOR UPDATE`, [userId, role]);
  },
  async grantRole(tx: Tx, orgId: string, userId: string, role: string): Promise<void> {
    await tx.query("INSERT INTO design_os.org_membership (org_id, user_id, role, granted_by) VALUES ($1, $2, $3, design_os.current_user_id())", [orgId, userId, role]);
  },
  async reactivateRole(tx: Tx, userId: string, role: string): Promise<void> {
    await tx.query(`UPDATE design_os.org_membership SET status = 'ACTIVE', granted_by = design_os.current_user_id(), granted_at = now()
      WHERE org_id = design_os.current_org_id() AND user_id = $1 AND role = $2 AND status = 'REVOKED'`, [userId, role]);
  },
  async revokeRole(tx: Tx, userId: string, role: string): Promise<void> {
    await tx.query("UPDATE design_os.org_membership SET status = 'REVOKED' WHERE org_id = design_os.current_org_id() AND user_id = $1 AND role = $2 AND status = 'ACTIVE'", [userId, role]);
  },
  /** Active ADMIN memberships of the organization, locked so concurrent revocations serialize. */
  async activeAdmins(tx: Tx): Promise<string[]> {
    return (await tx.query<{ user_id: string }>(`SELECT m.user_id FROM design_os.org_membership m JOIN design_os.app_user u ON u.id = m.user_id
      WHERE m.org_id = design_os.current_org_id() AND m.role = 'ADMIN' AND m.status = 'ACTIVE' AND u.status = 'ACTIVE' ORDER BY m.user_id FOR UPDATE OF m`)).map((r) => r.user_id);
  },
};
