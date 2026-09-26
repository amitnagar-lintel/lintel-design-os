-- 0011 down
SET LOCAL ROLE design_os_owner;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA design_os FROM design_os_api;
REVOKE ALL ON ALL TABLES IN SCHEMA design_os FROM design_os_api;
REVOKE USAGE ON SCHEMA design_os FROM design_os_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA design_os TO PUBLIC;
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['guard_draft_content()', 'guard_membership_identity()', 'guard_client_contact_identity()', 'guard_project_member()', 'guard_product_recipe()',
                           'guard_design_version_room()', 'guard_design_object_product()', 'check_snapshot_provenance()', 'check_issue()', 'seed_org_permissions()'] LOOP
    EXECUTE format('ALTER FUNCTION design_os.%s SECURITY INVOKER RESET search_path', f);
  END LOOP;
END $$;
