-- 0011 grants and hardening (M5 §9.2, §11): least privilege for the API role. The schema is not exposed to
-- Supabase's auto-generated REST roles (anon / authenticated / service_role get nothing); the NestJS API
-- (design_os_api) is the only application boundary. Lifecycle columns are never updatable by the API.
SET LOCAL ROLE design_os_owner;

-- Integrity triggers that look up other tables run as the owner, so row-level security cannot hide the rows they check.
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['guard_draft_content()', 'guard_membership_identity()', 'guard_client_contact_identity()', 'guard_project_member()', 'guard_product_recipe()',
                           'guard_design_version_room()', 'guard_design_object_product()', 'check_snapshot_provenance()', 'check_issue()', 'seed_org_permissions()'] LOOP
    EXECUTE format('ALTER FUNCTION design_os.%s SECURITY DEFINER SET search_path = design_os, pg_temp', f);
  END LOOP;
END $$;

REVOKE ALL ON SCHEMA design_os FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA design_os FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA design_os FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA design_os FROM PUBLIC;

-- Supabase REST roles: nothing (the schema is also not added to PostgREST's exposed schemas).
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA design_os FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA design_os FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA design_os FROM %I', r);
    END IF;
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA design_os TO design_os_api;

DO $$
DECLARE
  t text;
  cols text;
  read_only text[] := ARRAY['versioned_table', 'role', 'permission', 'default_role_permission', 'construction_variable', 'planning_variable', 'manufacturing_variable',
                            'organization', 'app_user', 'approval_request', 'approval_decision', 'audit_log'];
  insert_only text[] := ARRAY['room_revision', 'validation_run', 'file_object', 'bom_snapshot', 'boq_snapshot', 'pricing_snapshot', 'quotation_snapshot', 'drawing_snapshot',
                              'manufacturing_document_snapshot', 'quotation_issue', 'drawing_issue', 'drawing_snapshot_file', 'manufacturing_document_snapshot_file'];
  version_tables text[] := ARRAY(SELECT split_part(version_table::text, '.', 2) FROM design_os.versioned_table);
  frozen_columns text[] := design_os.lifecycle_columns() || ARRAY['id', 'org_id', 'entity_id', 'version_number', 'created_by', 'created_at', 'row_version', 'data_classification'];
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'design_os' ORDER BY tablename LOOP
    IF t = ANY (read_only) THEN
      EXECUTE format('GRANT SELECT ON design_os.%I TO design_os_api', t);
    ELSIF t = ANY (insert_only) THEN
      EXECUTE format('GRANT SELECT, INSERT ON design_os.%I TO design_os_api', t);
    ELSIF t = ANY (version_tables) THEN
      SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
        FROM information_schema.columns WHERE table_schema = 'design_os' AND table_name = t AND column_name <> ALL (frozen_columns);
      EXECUTE format('GRANT SELECT, INSERT, DELETE ON design_os.%I TO design_os_api', t);
      EXECUTE format('GRANT UPDATE (%s) ON design_os.%I TO design_os_api', cols, t);
    ELSIF t = 'role_permission' THEN
      EXECUTE format('GRANT SELECT, INSERT, DELETE ON design_os.%I TO design_os_api', t);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON design_os.%I TO design_os_api', t);
    END IF;
  END LOOP;
END $$;

-- Functions the API role may call directly or that its policies / constraints / guards evaluate.
GRANT EXECUTE ON FUNCTION
  design_os.claims(), design_os.current_user_id(), design_os.current_org_id(), design_os.is_internal(), design_os.has_permission(text),
  design_os.can_access_project(uuid), design_os.design_version_project(uuid), design_os.room_project(uuid), design_os.is_issued(text, uuid),
  design_os.client_can_read_file(uuid), design_os.lifecycle_columns(), design_os.client_allowed_actions(), design_os.finance_approval_actions(),
  design_os.transition(text, uuid, text, text, text)
TO design_os_api;
