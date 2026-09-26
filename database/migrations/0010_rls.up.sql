-- 0010 row-level security (M5 §9, D4, D10): RLS on every design_os table, default deny. Policies apply to the
-- API role (design_os_api); the API also checks every rule itself (defence in depth). The owner role bypasses
-- RLS only inside SECURITY DEFINER functions, which do their own tenant checks.
SET LOCAL ROLE design_os_owner;

CREATE FUNCTION design_os.design_version_project(p_design_version uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$ SELECT project_id FROM design_os.design_version WHERE id = p_design_version AND org_id = design_os.current_org_id() $$;

CREATE FUNCTION design_os.room_project(p_room uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$ SELECT project_id FROM design_os.room WHERE id = p_room AND org_id = design_os.current_org_id() $$;

CREATE FUNCTION design_os.is_issued(p_kind text, p_snapshot uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
    SELECT CASE p_kind
      WHEN 'QUOTATION' THEN EXISTS (SELECT 1 FROM design_os.quotation_issue WHERE snapshot_id = p_snapshot AND org_id = design_os.current_org_id())
      WHEN 'DRAWING' THEN EXISTS (SELECT 1 FROM design_os.drawing_issue WHERE snapshot_id = p_snapshot AND org_id = design_os.current_org_id())
      ELSE false END
  $$;

-- A file is visible to a client only through an issued drawing of a project they can access.
CREATE FUNCTION design_os.client_can_read_file(p_file uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM design_os.drawing_snapshot_file f JOIN design_os.drawing_snapshot s ON s.id = f.snapshot_id
      WHERE f.file_object_id = p_file AND f.org_id = design_os.current_org_id() AND design_os.is_issued('DRAWING', s.id)
        AND design_os.can_access_project(design_os.design_version_project(s.design_version_id)))
  $$;

-- Deny by default: enable RLS everywhere.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'design_os' LOOP
    EXECUTE format('ALTER TABLE design_os.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- schema registries: readable, never writable via the API

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['versioned_table', 'role', 'permission', 'default_role_permission', 'construction_variable', 'planning_variable', 'manufacturing_variable'] LOOP
    EXECUTE format('CREATE POLICY registry_read ON design_os.%I FOR SELECT TO design_os_api USING (true)', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- reference data: internal read; author permission per domain to write

DO $$
DECLARE
  g record;
  t text;
BEGIN
  FOR g IN SELECT * FROM (VALUES
    ('construction_standard.author', ARRAY['construction_standard', 'construction_standard_version', 'construction_standard_value']),
    ('planning_standard.author', ARRAY['planning_standard', 'planning_standard_version', 'planning_standard_value']),
    ('edge_band_standard.author', ARRAY['edge_band_standard', 'edge_band_standard_version', 'edge_band_rule_set', 'edge_band_rule']),
    ('manufacturing_standard.author', ARRAY['manufacturing_standard', 'manufacturing_standard_version', 'manufacturing_standard_value']),
    ('pricing_standard.author', ARRAY['pricing_standard', 'pricing_standard_version', 'rate_card_line']),
    ('quotation_policy.author', ARRAY['quotation_policy', 'quotation_policy_version', 'tax_rate', 'tax_rate_mapping']),
    ('material_catalog.author', ARRAY['material', 'material_version', 'edge_band', 'edge_band_version', 'material_catalog', 'material_catalog_version', 'material_catalog_version_material', 'material_catalog_version_edge_band']),
    ('finish_catalog.author', ARRAY['finish', 'finish_version', 'finish_material_compatibility', 'finish_catalog', 'finish_catalog_version', 'finish_catalog_version_finish']),
    ('hardware_catalog.author', ARRAY['hardware_item', 'hardware_item_version', 'hardware_rule_set', 'hardware_rule_set_version', 'hardware_rule', 'hardware_catalog', 'hardware_catalog_version', 'hardware_catalog_version_hardware_item', 'hardware_catalog_version_hardware_rule_set']),
    ('appliance_catalog.author', ARRAY['appliance', 'appliance_version', 'appliance_catalog', 'appliance_catalog_version', 'appliance_catalog_version_appliance']),
    ('product_catalog.author', ARRAY['construction_recipe', 'recipe_version', 'product', 'product_version', 'product_catalog', 'product_catalog_version', 'product_catalog_version_product']),
    ('hettich.author', ARRAY['hettich_dataset', 'hettich_dataset_version', 'hettich_article', 'hettich_calculation_rule'])
  ) AS x(action, tables) LOOP
    FOREACH t IN ARRAY g.tables LOOP
      EXECUTE format('CREATE POLICY ref_read ON design_os.%I FOR SELECT TO design_os_api USING (org_id = design_os.current_org_id() AND design_os.is_internal() AND design_os.has_permission(''reference.read''))', t);
      EXECUTE format('CREATE POLICY ref_insert ON design_os.%I FOR INSERT TO design_os_api WITH CHECK (org_id = design_os.current_org_id() AND design_os.has_permission(%L))', t, g.action);
      EXECUTE format('CREATE POLICY ref_update ON design_os.%I FOR UPDATE TO design_os_api USING (org_id = design_os.current_org_id() AND design_os.has_permission(%L)) WITH CHECK (org_id = design_os.current_org_id() AND design_os.has_permission(%L))', t, g.action, g.action);
      EXECUTE format('CREATE POLICY ref_delete ON design_os.%I FOR DELETE TO design_os_api USING (org_id = design_os.current_org_id() AND design_os.has_permission(%L))', t, g.action);
    END LOOP;
  END LOOP;
END $$;

-- ---------------------------------------------------------------- tenancy and access

CREATE POLICY own_org ON design_os.organization FOR SELECT TO design_os_api USING (id = design_os.current_org_id());

CREATE POLICY visible_users ON design_os.app_user FOR SELECT TO design_os_api USING (
  id = design_os.current_user_id()
  OR (design_os.is_internal() AND EXISTS (SELECT 1 FROM design_os.org_membership m WHERE m.user_id = app_user.id AND m.org_id = design_os.current_org_id())));

CREATE POLICY membership_read ON design_os.org_membership FOR SELECT TO design_os_api
  USING (org_id = design_os.current_org_id() AND (design_os.is_internal() OR user_id = design_os.current_user_id()));
CREATE POLICY membership_insert ON design_os.org_membership FOR INSERT TO design_os_api WITH CHECK (org_id = design_os.current_org_id() AND design_os.has_permission('org.members.manage'));
CREATE POLICY membership_update ON design_os.org_membership FOR UPDATE TO design_os_api
  USING (org_id = design_os.current_org_id() AND design_os.has_permission('org.members.manage')) WITH CHECK (org_id = design_os.current_org_id() AND design_os.has_permission('org.members.manage'));
CREATE POLICY membership_delete ON design_os.org_membership FOR DELETE TO design_os_api USING (org_id = design_os.current_org_id() AND design_os.has_permission('org.members.manage'));

CREATE POLICY grants_read ON design_os.role_permission FOR SELECT TO design_os_api USING (org_id = design_os.current_org_id() AND design_os.is_internal());
CREATE POLICY grants_insert ON design_os.role_permission FOR INSERT TO design_os_api WITH CHECK (org_id = design_os.current_org_id() AND design_os.has_permission('org.role_permissions.manage'));
CREATE POLICY grants_delete ON design_os.role_permission FOR DELETE TO design_os_api USING (org_id = design_os.current_org_id() AND design_os.has_permission('org.role_permissions.manage'));

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client', 'client_contact'] LOOP
    EXECUTE format('CREATE POLICY client_read ON design_os.%I FOR SELECT TO design_os_api USING (org_id = design_os.current_org_id() AND design_os.is_internal() AND design_os.has_permission(''client.read''))', t);
    EXECUTE format('CREATE POLICY client_insert ON design_os.%I FOR INSERT TO design_os_api WITH CHECK (org_id = design_os.current_org_id() AND design_os.is_internal() AND design_os.has_permission(''client.write''))', t);
    EXECUTE format('CREATE POLICY client_update ON design_os.%I FOR UPDATE TO design_os_api USING (org_id = design_os.current_org_id() AND design_os.is_internal() AND design_os.has_permission(''client.write'')) WITH CHECK (org_id = design_os.current_org_id() AND design_os.has_permission(''client.write''))', t);
  END LOOP;
END $$;

CREATE POLICY project_read ON design_os.project FOR SELECT TO design_os_api USING (design_os.can_access_project(id));
CREATE POLICY project_insert ON design_os.project FOR INSERT TO design_os_api WITH CHECK (org_id = design_os.current_org_id() AND design_os.is_internal() AND design_os.has_permission('project.write'));
CREATE POLICY project_update ON design_os.project FOR UPDATE TO design_os_api
  USING (design_os.can_access_project(id) AND design_os.is_internal() AND design_os.has_permission('project.write')) WITH CHECK (org_id = design_os.current_org_id());

-- Clients never assign anyone (the action cannot be granted to CLIENT; see role_permission constraints).
CREATE POLICY member_read ON design_os.project_member FOR SELECT TO design_os_api
  USING ((design_os.is_internal() AND design_os.can_access_project(project_id)) OR (org_id = design_os.current_org_id() AND user_id = design_os.current_user_id()));
CREATE POLICY member_insert ON design_os.project_member FOR INSERT TO design_os_api
  WITH CHECK (design_os.is_internal() AND design_os.can_access_project(project_id) AND design_os.has_permission('project_members.assign') AND granted_by = design_os.current_user_id());
CREATE POLICY member_delete ON design_os.project_member FOR DELETE TO design_os_api
  USING (design_os.is_internal() AND design_os.can_access_project(project_id) AND design_os.has_permission('project_members.assign'));

-- ---------------------------------------------------------------- rooms and designs (internal, project-scoped)

CREATE POLICY room_read ON design_os.room FOR SELECT TO design_os_api USING (design_os.is_internal() AND design_os.can_access_project(project_id));
CREATE POLICY room_insert ON design_os.room FOR INSERT TO design_os_api WITH CHECK (design_os.can_access_project(project_id) AND design_os.has_permission('room.survey.write'));
CREATE POLICY room_update ON design_os.room FOR UPDATE TO design_os_api USING (design_os.can_access_project(project_id) AND design_os.has_permission('room.survey.write')) WITH CHECK (design_os.can_access_project(project_id));

CREATE POLICY revision_read ON design_os.room_revision FOR SELECT TO design_os_api USING (design_os.is_internal() AND design_os.can_access_project(design_os.room_project(room_id)));
CREATE POLICY revision_insert ON design_os.room_revision FOR INSERT TO design_os_api
  WITH CHECK (design_os.can_access_project(design_os.room_project(room_id)) AND design_os.has_permission('room.survey.write') AND surveyed_by = design_os.current_user_id());

CREATE POLICY design_read ON design_os.design FOR SELECT TO design_os_api USING (design_os.is_internal() AND design_os.can_access_project(project_id));
CREATE POLICY design_insert ON design_os.design FOR INSERT TO design_os_api WITH CHECK (design_os.can_access_project(project_id) AND design_os.has_permission('design_version.author'));
CREATE POLICY design_update ON design_os.design FOR UPDATE TO design_os_api USING (design_os.can_access_project(project_id) AND design_os.has_permission('design_version.author')) WITH CHECK (design_os.can_access_project(project_id));

CREATE POLICY dv_read ON design_os.design_version FOR SELECT TO design_os_api USING (design_os.is_internal() AND design_os.can_access_project(project_id));
CREATE POLICY dv_insert ON design_os.design_version FOR INSERT TO design_os_api WITH CHECK (design_os.can_access_project(project_id) AND design_os.has_permission('design_version.author'));
CREATE POLICY dv_update ON design_os.design_version FOR UPDATE TO design_os_api
  USING (design_os.can_access_project(project_id) AND design_os.has_permission('design_version.author')) WITH CHECK (design_os.can_access_project(project_id));
CREATE POLICY dv_delete ON design_os.design_version FOR DELETE TO design_os_api USING (design_os.can_access_project(project_id) AND design_os.has_permission('design_version.author'));

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['design_object', 'relationship_override'] LOOP
    EXECUTE format('CREATE POLICY content_read ON design_os.%I FOR SELECT TO design_os_api USING (design_os.is_internal() AND design_os.can_access_project(design_os.design_version_project(design_version_id)))', t);
    EXECUTE format('CREATE POLICY content_insert ON design_os.%I FOR INSERT TO design_os_api WITH CHECK (design_os.can_access_project(design_os.design_version_project(design_version_id)) AND design_os.has_permission(''design_version.author''))', t);
    EXECUTE format('CREATE POLICY content_update ON design_os.%I FOR UPDATE TO design_os_api USING (design_os.can_access_project(design_os.design_version_project(design_version_id)) AND design_os.has_permission(''design_version.author'')) WITH CHECK (design_os.can_access_project(design_os.design_version_project(design_version_id)))', t);
    EXECUTE format('CREATE POLICY content_delete ON design_os.%I FOR DELETE TO design_os_api USING (design_os.can_access_project(design_os.design_version_project(design_version_id)) AND design_os.has_permission(''design_version.author''))', t);
  END LOOP;
END $$;

CREATE POLICY run_read ON design_os.validation_run FOR SELECT TO design_os_api USING (design_os.is_internal() AND design_os.can_access_project(design_os.design_version_project(design_version_id)));
-- No insert policy: validation runs are created only through design_os.record_validation_run() (SECURITY DEFINER).

-- ---------------------------------------------------------------- snapshots, issues and files

DO $$
DECLARE
  s record;
BEGIN
  FOR s IN SELECT * FROM (VALUES
    ('bom_snapshot', 'output.read.production', 'output.generate.engineering', false),
    ('boq_snapshot', 'output.read.production', 'output.generate.engineering', false),
    ('drawing_snapshot', 'output.read.production', 'output.generate.engineering', true),
    ('manufacturing_document_snapshot', 'output.read.production', 'manufacturing.release', false),
    ('pricing_snapshot', 'output.read.cost', 'output.generate.commercial', false),
    ('quotation_snapshot', 'output.read.cost', 'output.generate.commercial', true)
  ) AS x(t, read_action, write_action, issuable) LOOP
    EXECUTE format('CREATE POLICY snapshot_read ON design_os.%I FOR SELECT TO design_os_api USING (design_os.is_internal() AND design_os.can_access_project(design_os.design_version_project(design_version_id)) AND design_os.has_permission(%L))',
      s.t, s.read_action);
    IF s.issuable THEN
      -- Issued quotations / drawings: readable with output.read.issued, including by the project's CLIENT contacts.
      EXECUTE format('CREATE POLICY snapshot_read_issued ON design_os.%I FOR SELECT TO design_os_api USING (design_os.is_issued(kind::text, id) AND design_os.can_access_project(design_os.design_version_project(design_version_id)) AND design_os.has_permission(''output.read.issued''))', s.t);
    END IF;
    EXECUTE format('CREATE POLICY snapshot_insert ON design_os.%I FOR INSERT TO design_os_api WITH CHECK (design_os.is_internal() AND design_os.can_access_project(design_os.design_version_project(design_version_id)) AND design_os.has_permission(%L) AND created_by = design_os.current_user_id())',
      s.t, s.write_action);
  END LOOP;
END $$;

CREATE POLICY issue_read ON design_os.quotation_issue FOR SELECT TO design_os_api USING (org_id = design_os.current_org_id() AND (design_os.is_internal() OR design_os.has_permission('output.read.issued')));
CREATE POLICY issue_insert ON design_os.quotation_issue FOR INSERT TO design_os_api
  WITH CHECK (org_id = design_os.current_org_id() AND design_os.is_internal() AND design_os.has_permission('quotation.issue') AND issued_by = design_os.current_user_id());
CREATE POLICY issue_read ON design_os.drawing_issue FOR SELECT TO design_os_api USING (org_id = design_os.current_org_id() AND (design_os.is_internal() OR design_os.has_permission('output.read.issued')));
CREATE POLICY issue_insert ON design_os.drawing_issue FOR INSERT TO design_os_api
  WITH CHECK (org_id = design_os.current_org_id() AND design_os.is_internal() AND design_os.has_permission('drawing.issue') AND issued_by = design_os.current_user_id());

CREATE POLICY file_read ON design_os.file_object FOR SELECT TO design_os_api
  USING (org_id = design_os.current_org_id() AND ((design_os.is_internal() AND design_os.has_permission('output.read.production')) OR design_os.client_can_read_file(id)));
CREATE POLICY file_insert ON design_os.file_object FOR INSERT TO design_os_api
  WITH CHECK (org_id = design_os.current_org_id() AND design_os.is_internal() AND created_by = design_os.current_user_id()
              AND (design_os.has_permission('output.generate.engineering') OR design_os.has_permission('manufacturing.release')));

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['drawing_snapshot_file', 'manufacturing_document_snapshot_file'] LOOP
    EXECUTE format('CREATE POLICY link_read ON design_os.%I FOR SELECT TO design_os_api USING (org_id = design_os.current_org_id() AND ((design_os.is_internal() AND design_os.has_permission(''output.read.production'')) OR design_os.client_can_read_file(file_object_id)))', t);
    EXECUTE format('CREATE POLICY link_insert ON design_os.%I FOR INSERT TO design_os_api WITH CHECK (org_id = design_os.current_org_id() AND design_os.is_internal() AND (design_os.has_permission(''output.generate.engineering'') OR design_os.has_permission(''manufacturing.release'')))', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- governance (written only by SECURITY DEFINER functions / triggers)

CREATE POLICY request_read ON design_os.approval_request FOR SELECT TO design_os_api USING (org_id = design_os.current_org_id() AND design_os.is_internal());
CREATE POLICY decision_read ON design_os.approval_decision FOR SELECT TO design_os_api USING (org_id = design_os.current_org_id() AND design_os.is_internal());
CREATE POLICY audit_read ON design_os.audit_log FOR SELECT TO design_os_api USING (org_id = design_os.current_org_id() AND design_os.has_permission('audit.read'));
