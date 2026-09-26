-- 0019 organization onboarding (M6 G4): internal-user invitations and self-provisioning on first sign-in.
--
-- An administrator (org.members.manage) invites a named person by email with one or more INTERNAL roles. The
-- person signs in through Supabase Auth; the API then provisions their app_user row and org memberships from the
-- PENDING invitation addressed to their own Supabase Auth email. Declarative only: a table, constraints, row-level
-- security policies and grants; no new trigger or PL/pgSQL rule. The existing guards still apply (identity kind,
-- membership identity, audit hash chain), and the existing RBAC roles and role → action grants stay authoritative.
--
-- Not changed: organizations are created only by the operator tool (apps/db-tools, `org init`); CLIENT identities
-- keep their own path (client_contact INVITED → ACTIVE, for the later client portal) and can never be invited here.
SET LOCAL ROLE design_os_owner;

-- The caller's own Supabase Auth email (lower case), or NULL. Reads only the caller's row of auth.users.
CREATE FUNCTION design_os.current_auth_email() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$ SELECT lower(u.email) FROM auth.users u WHERE u.id = design_os.current_user_id() $$;

-- True when an array of roles holds no role twice.
CREATE FUNCTION design_os.roles_distinct(p_roles design_os.design_os_role[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT count(DISTINCT r) = count(*) FROM unnest(p_roles) AS r $$;

CREATE TABLE design_os.org_invitation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  email text NOT NULL,
  display_name text NOT NULL,
  roles design_os.design_os_role[] NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED')),
  -- NULL only for the first ADMIN invitation of a new organization, written by the operator tool.
  invited_by uuid REFERENCES design_os.app_user (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  accepted_by uuid REFERENCES design_os.app_user (id),
  accepted_at timestamptz,
  revoked_by uuid REFERENCES design_os.app_user (id),
  revoked_at timestamptz,
  CONSTRAINT org_invitation_org_id_unique UNIQUE (org_id, id),
  CONSTRAINT org_invitation_email_normalized CHECK (email = lower(btrim(email)) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  CONSTRAINT org_invitation_display_name CHECK (btrim(display_name) <> '' AND length(display_name) <= 200),
  CONSTRAINT org_invitation_roles CHECK (cardinality(roles) BETWEEN 1 AND 9 AND NOT ('CLIENT' = ANY (roles)) AND design_os.roles_distinct(roles)),
  CONSTRAINT org_invitation_expiry CHECK (expires_at > created_at),
  CONSTRAINT org_invitation_state CHECK (
    (status = 'PENDING' AND accepted_by IS NULL AND accepted_at IS NULL AND revoked_by IS NULL AND revoked_at IS NULL)
    OR (status = 'ACCEPTED' AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL AND revoked_by IS NULL AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL AND accepted_by IS NULL AND accepted_at IS NULL))
);
-- At most one open invitation per person and organization.
CREATE UNIQUE INDEX org_invitation_pending_unique ON design_os.org_invitation (org_id, email) WHERE status = 'PENDING';
CREATE INDEX org_invitation_email ON design_os.org_invitation (email) WHERE status = 'PENDING';

CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON design_os.org_invitation FOR EACH ROW EXECUTE FUNCTION design_os.audit_row();
ALTER TABLE design_os.org_invitation ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------- invitations

-- Administrators of the organization see its invitations; a person sees the invitations addressed to their own email.
CREATE POLICY invitation_read ON design_os.org_invitation FOR SELECT TO design_os_api USING (
  (org_id = design_os.current_org_id() AND design_os.is_internal() AND design_os.has_permission('org.members.manage'))
  OR email = design_os.current_auth_email());

CREATE POLICY invitation_insert ON design_os.org_invitation FOR INSERT TO design_os_api WITH CHECK (
  org_id = design_os.current_org_id() AND design_os.is_internal() AND design_os.has_permission('org.members.manage')
  AND invited_by = design_os.current_user_id() AND status = 'PENDING');

-- PENDING → REVOKED, by an administrator of the organization.
CREATE POLICY invitation_revoke ON design_os.org_invitation FOR UPDATE TO design_os_api
  USING (org_id = design_os.current_org_id() AND design_os.is_internal() AND design_os.has_permission('org.members.manage') AND status = 'PENDING')
  WITH CHECK (org_id = design_os.current_org_id() AND design_os.is_internal() AND design_os.has_permission('org.members.manage')
    AND status = 'REVOKED' AND revoked_by = design_os.current_user_id());

-- PENDING → ACCEPTED, only by the signed-in person the invitation is addressed to, before it expires.
CREATE POLICY invitation_accept ON design_os.org_invitation FOR UPDATE TO design_os_api
  USING (status = 'PENDING' AND expires_at > now() AND email = design_os.current_auth_email())
  WITH CHECK (status = 'ACCEPTED' AND accepted_by = design_os.current_user_id() AND expires_at > now() AND email = design_os.current_auth_email());

-- ---------------------------------------------------------------- self-provisioning from an invitation

-- A signed-in person creates their own INTERNAL identity, with their own Supabase Auth email and the name the
-- administrator gave them, only while an invitation for that email is PENDING.
CREATE POLICY user_self_provision ON design_os.app_user FOR INSERT TO design_os_api WITH CHECK (
  id = design_os.current_user_id() AND identity_kind = 'INTERNAL' AND status = 'ACTIVE' AND lower(email) = design_os.current_auth_email()
  AND EXISTS (SELECT 1 FROM design_os.org_invitation i
              WHERE i.status = 'PENDING' AND i.expires_at > now() AND i.email = design_os.current_auth_email() AND i.display_name = app_user.display_name));

-- The invited roles only, in the inviting organization only, recorded as granted by the inviting administrator.
CREATE POLICY membership_accept ON design_os.org_membership FOR INSERT TO design_os_api WITH CHECK (
  user_id = design_os.current_user_id() AND status = 'ACTIVE'
  AND EXISTS (SELECT 1 FROM design_os.org_invitation i
              WHERE i.org_id = org_membership.org_id AND i.status = 'PENDING' AND i.expires_at > now() AND i.email = design_os.current_auth_email()
                AND org_membership.role = ANY (i.roles) AND org_membership.granted_by IS NOT DISTINCT FROM i.invited_by));

-- A previously REVOKED membership of an invited role is re-activated the same way (the person may read only those rows).
CREATE POLICY membership_accept_read ON design_os.org_membership FOR SELECT TO design_os_api USING (
  user_id = design_os.current_user_id()
  AND EXISTS (SELECT 1 FROM design_os.org_invitation i
              WHERE i.org_id = org_membership.org_id AND i.status = 'PENDING' AND i.expires_at > now() AND i.email = design_os.current_auth_email()
                AND org_membership.role = ANY (i.roles)));
CREATE POLICY membership_accept_reactivate ON design_os.org_membership FOR UPDATE TO design_os_api
  USING (user_id = design_os.current_user_id()
    AND EXISTS (SELECT 1 FROM design_os.org_invitation i
                WHERE i.org_id = org_membership.org_id AND i.status = 'PENDING' AND i.expires_at > now() AND i.email = design_os.current_auth_email()
                  AND org_membership.role = ANY (i.roles)))
  WITH CHECK (user_id = design_os.current_user_id() AND status = 'ACTIVE'
    AND EXISTS (SELECT 1 FROM design_os.org_invitation i
                WHERE i.org_id = org_membership.org_id AND i.status = 'PENDING' AND i.expires_at > now() AND i.email = design_os.current_auth_email()
                  AND org_membership.role = ANY (i.roles) AND org_membership.granted_by IS NOT DISTINCT FROM i.invited_by));

-- ---------------------------------------------------------------- grants

REVOKE ALL ON design_os.org_invitation FROM PUBLIC;
GRANT SELECT, INSERT ON design_os.org_invitation TO design_os_api;
GRANT UPDATE (status, accepted_by, accepted_at, revoked_by, revoked_at) ON design_os.org_invitation TO design_os_api;
-- app_user stays read-only except this self-provisioning insert (status and created_at take their defaults).
GRANT INSERT (id, email, display_name, identity_kind) ON design_os.app_user TO design_os_api;

REVOKE ALL ON FUNCTION design_os.current_auth_email(), design_os.roles_distinct(design_os.design_os_role[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION design_os.current_auth_email(), design_os.roles_distinct(design_os.design_os_role[]) TO design_os_api;
