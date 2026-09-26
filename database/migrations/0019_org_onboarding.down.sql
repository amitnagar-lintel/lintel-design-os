-- Rollback of 0019 organization onboarding: the self-provisioning policies and grants, the invitation table, the helpers.
SET LOCAL ROLE design_os_owner;

DROP POLICY membership_accept_reactivate ON design_os.org_membership;
DROP POLICY membership_accept_read ON design_os.org_membership;
DROP POLICY membership_accept ON design_os.org_membership;
DROP POLICY user_self_provision ON design_os.app_user;
REVOKE INSERT (id, email, display_name, identity_kind) ON design_os.app_user FROM design_os_api;

DROP TABLE design_os.org_invitation;
DROP FUNCTION design_os.roles_distinct(design_os.design_os_role[]);
DROP FUNCTION design_os.current_auth_email();
