-- 0013 down
SET LOCAL ROLE design_os_owner;
CREATE OR REPLACE FUNCTION design_os.unaudited_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT ARRAY['audit_log', 'versioned_table', 'role', 'permission', 'default_role_permission', 'construction_variable', 'planning_variable', 'manufacturing_variable', 'error_code'] $$;
DROP FUNCTION design_os.complete_idempotency(uuid, smallint, jsonb, text, uuid);
DROP FUNCTION design_os.claim_idempotency(text, text, text, interval);
DROP TABLE design_os.idempotency_record;
DROP FUNCTION design_os.check_idempotency_completed();
DROP FUNCTION design_os.guard_idempotency_record();
DROP FUNCTION design_os.current_memberships();
