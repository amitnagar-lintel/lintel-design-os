-- 0013 down
SET LOCAL ROLE design_os_owner;
CREATE OR REPLACE FUNCTION design_os.unaudited_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT ARRAY['audit_log', 'versioned_table', 'role', 'permission', 'default_role_permission', 'construction_variable', 'planning_variable', 'manufacturing_variable', 'error_code', 'output_purpose_rule'] $$;
DROP FUNCTION design_os.complete_idempotency(uuid, smallint, jsonb, text, uuid);
DROP FUNCTION design_os.claim_idempotency(text, text, text, interval);
DROP TABLE design_os.idempotency_record;
DROP FUNCTION design_os.check_idempotency_completed();
DROP FUNCTION design_os.guard_idempotency_record();
DROP FUNCTION design_os.current_memberships();
CREATE OR REPLACE FUNCTION design_os.current_org_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
    SELECT m.org_id FROM design_os.org_membership m JOIN design_os.app_user u ON u.id = m.user_id
    WHERE m.user_id = design_os.current_user_id() AND m.org_id = nullif(design_os.claims() ->> 'org_id', '')::uuid
      AND m.status = 'ACTIVE' AND u.status = 'ACTIVE'
    LIMIT 1
  $$;
ALTER TABLE design_os.organization DROP CONSTRAINT organization_status_check;
ALTER TABLE design_os.organization ADD CONSTRAINT organization_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED'));
