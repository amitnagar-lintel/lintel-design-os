-- Rollback of 0020 readiness and audit read.
SET LOCAL ROLE design_os_owner;
DROP FUNCTION design_os.reference_approval_problems(text, uuid);
DROP FUNCTION design_os.audit_chain_status();
RESET ROLE;
REVOKE SELECT ON design_os_migrations.applied FROM design_os_api;
REVOKE USAGE ON SCHEMA design_os_migrations FROM design_os_api;
