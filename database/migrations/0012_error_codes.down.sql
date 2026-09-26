-- 0012 down: restore the 0001–0011 definitions (generic SQLSTATEs) and drop the error-code registry.
SET LOCAL ROLE design_os_owner;

CREATE OR REPLACE FUNCTION design_os.approval_problems(p_subject_type text, p_id uuid, p_org uuid) RETURNS text[]
  LANGUAGE plpgsql STABLE
  AS $$
DECLARE
  out text[] := ARRAY[]::text[];
  d record;
  st design_os.record_lifecycle_status;
  dv design_os.design_version%ROWTYPE;
  run design_os.validation_run%ROWTYPE;
BEGIN
  -- Every dependency must be APPROVED or LOCKED (SUPERSEDED, DRAFT, IN_REVIEW never satisfy approval).
  FOR d IN SELECT * FROM design_os.version_dependencies(p_subject_type, p_id, p_org) LOOP
    IF d.dep_version_id IS NULL THEN
      IF d.required THEN out := out || format('pin %s is not set', d.name); END IF;
      CONTINUE;
    END IF;
    st := design_os.version_status(d.dep_subject_type, d.dep_version_id, p_org);
    IF st IS NULL THEN
      out := out || format('%s %s not found in this organization', d.name, d.dep_version_id);
    ELSIF st NOT IN ('APPROVED', 'LOCKED') THEN
      out := out || format('%s %s is %s; it must be APPROVED or LOCKED', d.name, d.dep_version_id, st);
    END IF;
  END LOOP;

  IF p_subject_type = 'design' THEN
    -- Only the latest immutable engine run for exactly the current inputs (input_hash AND database input_revision) counts.
    SELECT * INTO dv FROM design_os.design_version WHERE id = p_id AND org_id = p_org;
    SELECT * INTO run FROM design_os.validation_run
      WHERE design_version_id = p_id AND org_id = p_org AND input_hash = dv.input_hash AND input_revision = dv.input_revision
      ORDER BY seq DESC LIMIT 1;
    IF NOT FOUND THEN out := out || 'no engine validation run exists for the current inputs'::text;
    ELSIF run.blocker_count > 0 THEN out := out || format('engine validation has %s BLOCKER(s)', run.blocker_count);
    END IF;
  ELSIF p_subject_type = 'construction_standard' THEN
    out := out || ARRAY(SELECT format('construction value %s is missing', c.code) FROM design_os.construction_variable c
                        WHERE NOT EXISTS (SELECT 1 FROM design_os.construction_standard_value v WHERE v.version_id = p_id AND v.variable_code = c.code) ORDER BY c.code);
    out := out || ARRAY(SELECT format('construction value %s is NULL / UNVERIFIED or has no source', v.variable_code) FROM design_os.construction_standard_value v
                        WHERE v.version_id = p_id AND (v.value IS NULL OR v.source IS NULL) ORDER BY v.variable_code);
  ELSIF p_subject_type = 'planning_standard' THEN
    out := out || ARRAY(SELECT format('planning value %s is missing', c.code) FROM design_os.planning_variable c
                        WHERE NOT EXISTS (SELECT 1 FROM design_os.planning_standard_value v WHERE v.version_id = p_id AND v.variable_code = c.code) ORDER BY c.code);
    out := out || ARRAY(SELECT format('planning value %s is NULL / UNVERIFIED or has no source', v.variable_code) FROM design_os.planning_standard_value v
                        WHERE v.version_id = p_id AND (v.value IS NULL OR v.source IS NULL) ORDER BY v.variable_code);
  ELSIF p_subject_type = 'manufacturing_standard' THEN
    -- Not approvable (and therefore not usable for approved designs) until its variable/value model is defined.
    IF NOT EXISTS (SELECT 1 FROM design_os.manufacturing_variable) THEN
      out := out || 'ManufacturingStandard has no defined variable model yet; it cannot be approved until its variables are defined'::text;
    END IF;
    out := out || ARRAY(SELECT format('manufacturing value %s is missing', c.code) FROM design_os.manufacturing_variable c
                        WHERE NOT EXISTS (SELECT 1 FROM design_os.manufacturing_standard_value v WHERE v.version_id = p_id AND v.variable_code = c.code) ORDER BY c.code);
    out := out || ARRAY(SELECT format('manufacturing value %s is NULL / UNVERIFIED or has no source', v.variable_code) FROM design_os.manufacturing_standard_value v
                        WHERE v.version_id = p_id AND (v.value IS NULL OR v.source IS NULL) ORDER BY v.variable_code);
  ELSIF p_subject_type = 'edge_band_standard' THEN
    -- At least one rule set; every rule set defines at least one component type (an empty rule set = rules not yet defined);
    -- every banded edge references an edge band that has an APPROVED or LOCKED version.
    IF NOT EXISTS (SELECT 1 FROM design_os.edge_band_rule r WHERE r.version_id = p_id) THEN
      out := out || 'EdgeBandStandard has no edge rules'::text;
    END IF;
    out := out || ARRAY(SELECT format('edge rule set %s has no edge rules', rs.rule_set_code) FROM design_os.edge_band_rule_set rs
                        WHERE rs.version_id = p_id AND NOT EXISTS (SELECT 1 FROM design_os.edge_band_rule r WHERE r.version_id = p_id AND r.rule_set_code = rs.rule_set_code)
                        ORDER BY rs.rule_set_code);
    out := out || ARRAY(SELECT DISTINCT format('edge band %s has no APPROVED or LOCKED version', r.edge_band_id) FROM design_os.edge_band_rule r
                        WHERE r.version_id = p_id AND r.edge_band_id IS NOT NULL AND NOT EXISTS (
                          SELECT 1 FROM design_os.edge_band e JOIN design_os.edge_band_version v ON v.entity_id = e.id AND v.org_id = e.org_id
                          WHERE e.org_id = p_org AND e.code = r.edge_band_id AND v.status IN ('APPROVED', 'LOCKED')));
  ELSIF p_subject_type = 'pricing_standard' THEN
    IF EXISTS (SELECT 1 FROM design_os.pricing_standard_version p WHERE p.id = p_id AND (p.manufacturing_cost_formula IS NULL OR p.wastage_board_pct IS NULL OR p.wastage_edge_band_pct IS NULL
        OR p.wastage_finish_pct IS NULL OR p.overhead_pct IS NULL OR p.margin_basis IS NULL OR p.margin_pct IS NULL OR p.gst_pct IS NULL)) THEN
      out := out || 'pricing rules contain NULL / UNVERIFIED values'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM design_os.rate_card_line l WHERE l.version_id = p_id) THEN out := out || 'rate card has no rates'::text; END IF;
    out := out || ARRAY(SELECT format('rate %s %s is NULL / UNVERIFIED', l.measure, l.item_key) FROM design_os.rate_card_line l WHERE l.version_id = p_id AND l.rate_paise IS NULL ORDER BY l.measure, l.item_key);
  ELSIF p_subject_type = 'quotation_policy' THEN
    IF EXISTS (SELECT 1 FROM design_os.quotation_policy_version q WHERE q.id = p_id AND (q.tax_policy IS NULL OR q.tax_rounding_mode IS NULL OR q.grand_total_rounding_mode IS NULL OR q.discount_mode IS NULL)) THEN
      out := out || 'quotation policy contains NULL / UNVERIFIED fields'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM design_os.tax_rate t WHERE t.version_id = p_id) THEN out := out || 'quotation policy has no tax rates'::text; END IF;
    IF NOT EXISTS (SELECT 1 FROM design_os.tax_rate_mapping m WHERE m.version_id = p_id) THEN out := out || 'quotation policy maps no product category to a tax rate'::text; END IF;
    out := out || ARRAY(SELECT format('tax rate %s is NULL / UNVERIFIED', t.rate_code) FROM design_os.tax_rate t WHERE t.version_id = p_id AND t.percent IS NULL ORDER BY t.rate_code);
    out := out || ARRAY(SELECT format('tax mapping for %s is NULL / UNVERIFIED', m.product_category) FROM design_os.tax_rate_mapping m WHERE m.version_id = p_id AND m.rate_code IS NULL ORDER BY m.product_category);
  ELSIF p_subject_type = 'hettich_dataset' THEN
    -- Source-verification STATE of the records (the full record validation stays in the TypeScript Hettich engine).
    IF NOT EXISTS (SELECT 1 FROM design_os.hettich_article a WHERE a.version_id = p_id) THEN
      out := out || 'Hettich dataset has no articles'::text;
    END IF;
    out := out || ARRAY(SELECT format('Hettich record %s is not source-verified', a.record_code) FROM design_os.hettich_article a
                        WHERE a.version_id = p_id AND (btrim(coalesce(a.article_number, '')) = '' OR a.category IS NULL
                          OR NOT design_os.is_official_hettich_url(a.source_ref ->> 'url') OR coalesce(a.source_ref ->> 'sourceDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
                          OR a.verified_by IS NULL OR a.verified_at IS NULL)
                        ORDER BY a.record_code);
    out := out || ARRAY(SELECT format('Hettich record %s is a fixture article', a.record_code) FROM design_os.hettich_article a
                        WHERE a.version_id = p_id AND a.article_number LIKE 'FIXTURE-%' ORDER BY a.record_code);
    out := out || ARRAY(SELECT format('Hettich record %s licence is %s', a.record_code, a.licence_status) FROM design_os.hettich_article a
                        WHERE a.version_id = p_id AND a.licence_status NOT IN ('OFFICIAL_PUBLIC', 'AUTHORISED') ORDER BY a.record_code);
    out := out || ARRAY(SELECT format('Hettich calculation rule %s is not source-verified', r.rule_code) FROM design_os.hettich_calculation_rule r
                        WHERE r.version_id = p_id AND (NOT design_os.is_official_hettich_url(r.source_ref ->> 'url')
                          OR r.verification ->> 'verifiedBy' IS NULL OR r.verification ->> 'verifiedAt' IS NULL)
                        ORDER BY r.rule_code);
    out := out || ARRAY(SELECT DISTINCT format('Hettich hinge family %s has no calculation rule', a.product_family) FROM design_os.hettich_article a
                        WHERE a.version_id = p_id AND a.category = 'HINGE' AND NOT EXISTS (
                          SELECT 1 FROM design_os.hettich_calculation_rule r WHERE r.version_id = p_id AND r.category = 'HINGE' AND r.family = a.product_family));
  ELSIF p_subject_type IN ('material_catalog', 'finish_catalog', 'hardware_catalog', 'appliance_catalog', 'product_catalog') THEN
    -- A catalog version must list at least one exact item version of its domain.
    IF NOT EXISTS (SELECT 1 FROM design_os.version_dependencies(p_subject_type, p_id, p_org)) THEN
      out := out || format('%s version has no items', p_subject_type);
    END IF;
  END IF;
  RETURN out;
END $$;

DROP FUNCTION design_os.approval_problem_items(text, uuid, uuid);

CREATE OR REPLACE FUNCTION design_os.unaudited_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT ARRAY['audit_log', 'versioned_table', 'role', 'permission', 'default_role_permission', 'construction_variable', 'planning_variable', 'manufacturing_variable'] $$;

CREATE OR REPLACE FUNCTION design_os.forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'design_os.%: rows are insert-only (% refused)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE OR REPLACE FUNCTION design_os.guard_version_row() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  privileged boolean := current_user = 'design_os_owner';
  lc text[] := design_os.lifecycle_columns() || ARRAY['row_version'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT privileged AND (NEW.status <> 'DRAFT' OR NEW.submitted_by IS NOT NULL OR NEW.approved_by IS NOT NULL OR NEW.locked_by IS NOT NULL OR NEW.superseded_by IS NOT NULL) THEN
      RAISE EXCEPTION 'design_os.%: a new version must start as DRAFT', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    NEW.row_version := 1;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'design_os.%: version % is % and can never be deleted', TG_TABLE_NAME, OLD.id, OLD.status USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF (to_jsonb(NEW) - lc) IS DISTINCT FROM (to_jsonb(OLD) - lc) AND OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'design_os.%: version % is % and its content is immutable', TG_TABLE_NAME, OLD.id, OLD.status USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT privileged AND
      (SELECT jsonb_object_agg(k, to_jsonb(NEW) -> k) FROM unnest(design_os.lifecycle_columns()) k) IS DISTINCT FROM
      (SELECT jsonb_object_agg(k, to_jsonb(OLD) -> k) FROM unnest(design_os.lifecycle_columns()) k) THEN
    RAISE EXCEPTION 'design_os.%: lifecycle changes only through design_os.transition()', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.row_version := OLD.row_version + 1;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION design_os.guard_draft_content() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
DECLARE
  r jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  parent_id uuid := (r ->> TG_ARGV[1])::uuid;
  parent_status design_os.record_lifecycle_status;
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) ->> TG_ARGV[1]) IS DISTINCT FROM (r ->> TG_ARGV[1]) THEN
    RAISE EXCEPTION 'design_os.%: rows cannot move to another version', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  EXECUTE format('SELECT status FROM %s WHERE id = $1', TG_ARGV[0]) INTO parent_status USING parent_id;
  IF parent_status IS NULL THEN
    RAISE EXCEPTION 'design_os.%: parent % % does not exist', TG_TABLE_NAME, TG_ARGV[0], parent_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'design_os.%: % % is % and its content is immutable', TG_TABLE_NAME, TG_ARGV[0], parent_id, parent_status USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE OR REPLACE FUNCTION design_os.guard_identity_kind() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.identity_kind IS DISTINCT FROM OLD.identity_kind THEN
    RAISE EXCEPTION 'design_os.app_user: identity_kind is fixed at creation' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION design_os.guard_membership_identity() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
DECLARE
  kind design_os.identity_kind;
BEGIN
  SELECT identity_kind INTO kind FROM design_os.app_user WHERE id = NEW.user_id;
  IF (NEW.role = 'CLIENT') <> (kind = 'CLIENT') THEN
    RAISE EXCEPTION 'design_os.org_membership: role % requires a % identity (user is %)', NEW.role, CASE WHEN NEW.role = 'CLIENT' THEN 'CLIENT' ELSE 'INTERNAL' END, kind
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION design_os.guard_client_contact_identity() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND (SELECT identity_kind FROM design_os.app_user WHERE id = NEW.user_id) <> 'CLIENT' THEN
    RAISE EXCEPTION 'design_os.client_contact: a contact can only be linked to a CLIENT identity' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION design_os.guard_project_member() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
DECLARE
  ok boolean;
BEGIN
  IF NEW.role = 'CLIENT' THEN
    SELECT EXISTS (
      SELECT 1 FROM design_os.client_contact cc JOIN design_os.project p ON p.id = NEW.project_id AND p.org_id = NEW.org_id
      WHERE cc.id = NEW.client_contact_id AND cc.org_id = NEW.org_id AND cc.client_id = p.client_id AND cc.user_id = NEW.user_id AND cc.status = 'ACTIVE'
    ) INTO ok;
    IF NOT ok THEN
      RAISE EXCEPTION 'design_os.project_member: a CLIENT member must be an ACTIVE contact of this project''s client' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM design_os.org_membership m JOIN design_os.app_user u ON u.id = m.user_id
      WHERE m.org_id = NEW.org_id AND m.user_id = NEW.user_id AND m.status = 'ACTIVE' AND u.identity_kind = 'INTERNAL'
    ) INTO ok;
    IF NOT ok THEN
      RAISE EXCEPTION 'design_os.project_member: % members must be active internal members of the organization', NEW.role USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION design_os.guard_product_recipe() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM design_os.recipe_version rv JOIN design_os.construction_recipe r ON r.id = rv.entity_id
    WHERE rv.id = NEW.recipe_version_id AND rv.org_id = NEW.org_id AND r.code = NEW.recipe_code
  ) THEN
    RAISE EXCEPTION 'design_os.product_version: recipe_version_id must be a version of recipe %', NEW.recipe_code USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION design_os.guard_design_version_room() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM design_os.design d JOIN design_os.room_revision rr ON rr.room_id = d.room_id AND rr.org_id = d.org_id
    WHERE d.id = NEW.entity_id AND d.org_id = NEW.org_id AND rr.id = NEW.room_revision_id
  ) THEN
    RAISE EXCEPTION 'design_os.design_version: room_revision_id must be a revision of the design''s room' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION design_os.guard_design_object_product() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM design_os.design_version dv
      JOIN design_os.product_catalog_version_product m ON m.catalog_version_id = dv.product_catalog_version_id AND m.org_id = dv.org_id
      JOIN design_os.product p ON p.id = m.product_id
    WHERE dv.id = NEW.design_version_id AND dv.org_id = NEW.org_id AND m.product_version_id = NEW.product_version_id AND p.code = NEW.product_code
  ) THEN
    RAISE EXCEPTION 'design_os.design_object: product version % (%) is not in the pinned product catalog version', NEW.product_version_id, NEW.product_code
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION design_os.record_validation_run(p_design_version_id uuid, p_input_hash text, p_engine_version text, p_engine_hash text,
                                                p_blocker_count integer, p_warning_count integer, p_messages jsonb, p_content_hash text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
DECLARE
  actor uuid := design_os.current_user_id();
  org uuid := design_os.current_org_id();
  dv design_os.design_version%ROWTYPE;
  run_id uuid;
BEGIN
  IF actor IS NULL OR org IS NULL OR NOT design_os.is_internal() THEN
    RAISE EXCEPTION 'record_validation_run: an authenticated internal member of the organization is required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (design_os.has_permission('output.generate.engineering') OR design_os.has_permission('design_version.author')) THEN
    RAISE EXCEPTION 'record_validation_run: missing permission to record engine validation runs' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO dv FROM design_os.design_version WHERE id = p_design_version_id AND org_id = org FOR SHARE;
  IF NOT FOUND OR NOT design_os.can_access_project(dv.project_id) THEN
    RAISE EXCEPTION 'record_validation_run: design version % not found', p_design_version_id USING ERRCODE = 'no_data_found';
  END IF;
  IF dv.status NOT IN ('DRAFT', 'IN_REVIEW') THEN
    RAISE EXCEPTION 'record_validation_run: design version is %; runs are recorded only for DRAFT or IN_REVIEW versions', dv.status USING ERRCODE = 'check_violation';
  END IF;
  IF p_input_hash IS DISTINCT FROM dv.input_hash THEN
    RAISE EXCEPTION 'record_validation_run: the run is for different inputs than the design version''s current input_hash' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO design_os.validation_run (org_id, design_version_id, input_hash, input_revision, engine_version, engine_hash, content_hash, blocker_count, warning_count, messages, created_by, created_at)
  VALUES (org, dv.id, dv.input_hash, dv.input_revision, p_engine_version, p_engine_hash, p_content_hash, p_blocker_count, p_warning_count, p_messages, actor, now())
  RETURNING id INTO run_id;
  RETURN run_id;
END $$;

CREATE OR REPLACE FUNCTION design_os.check_snapshot_provenance() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
DECLARE
  dv design_os.design_version%ROWTYPE;
  problems text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO dv FROM design_os.design_version WHERE id = NEW.design_version_id AND org_id = NEW.org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'design_os.%: design version % not found in this organization', TG_TABLE_NAME, NEW.design_version_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.design_version_status <> dv.status THEN problems := problems || format('design_version_status %s ≠ %s', NEW.design_version_status, dv.status); END IF;
  IF NEW.design_version_content_hash <> dv.content_hash THEN problems := problems || 'design_version_content_hash differs from the design version'::text; END IF;
  IF NEW.input_hash <> dv.input_hash THEN problems := problems || 'input_hash differs from the design version'::text; END IF;
  IF NEW.construction_standard_version_id <> dv.construction_standard_version_id THEN problems := problems || 'construction_standard_version_id ≠ pin'::text; END IF;
  IF NEW.planning_standard_version_id <> dv.planning_standard_version_id THEN problems := problems || 'planning_standard_version_id ≠ pin'::text; END IF;
  IF NEW.edge_band_standard_version_id <> dv.edge_band_standard_version_id THEN problems := problems || 'edge_band_standard_version_id ≠ pin'::text; END IF;
  IF NEW.material_catalog_version_id <> dv.material_catalog_version_id THEN problems := problems || 'material_catalog_version_id ≠ pin'::text; END IF;
  IF NEW.finish_catalog_version_id <> dv.finish_catalog_version_id THEN problems := problems || 'finish_catalog_version_id ≠ pin'::text; END IF;
  IF NEW.hardware_catalog_version_id <> dv.hardware_catalog_version_id THEN problems := problems || 'hardware_catalog_version_id ≠ pin'::text; END IF;
  IF NEW.product_catalog_version_id <> dv.product_catalog_version_id THEN problems := problems || 'product_catalog_version_id ≠ pin'::text; END IF;
  IF NEW.hettich_dataset_version_id <> dv.hettich_dataset_version_id THEN problems := problems || 'hettich_dataset_version_id ≠ pin'::text; END IF;
  IF NEW.appliance_catalog_version_id IS DISTINCT FROM dv.appliance_catalog_version_id THEN problems := problems || 'appliance_catalog_version_id ≠ pin'::text; END IF;
  IF NEW.kind IN ('PRICING', 'QUOTATION') THEN
    IF NEW.pricing_standard_version_id IS NULL OR NEW.pricing_standard_version_id IS DISTINCT FROM dv.pricing_standard_version_id THEN problems := problems || 'pricing_standard_version_id must equal the (non-null) pin'::text; END IF;
  ELSIF NEW.pricing_standard_version_id IS NOT NULL THEN problems := problems || 'pricing_standard_version_id does not apply to this output'::text;
  END IF;
  IF NEW.kind = 'QUOTATION' THEN
    IF NEW.quotation_policy_version_id IS NULL OR NEW.quotation_policy_version_id IS DISTINCT FROM dv.quotation_policy_version_id THEN problems := problems || 'quotation_policy_version_id must equal the (non-null) pin'::text; END IF;
  ELSIF NEW.quotation_policy_version_id IS NOT NULL THEN problems := problems || 'quotation_policy_version_id does not apply to this output'::text;
  END IF;
  IF NEW.kind = 'MANUFACTURING_DOCUMENT' THEN
    IF NEW.manufacturing_standard_version_id IS NULL OR NEW.manufacturing_standard_version_id IS DISTINCT FROM dv.manufacturing_standard_version_id THEN problems := problems || 'manufacturing_standard_version_id must equal the (non-null) pin'::text; END IF;
  ELSIF NEW.manufacturing_standard_version_id IS NOT NULL THEN problems := problems || 'manufacturing_standard_version_id does not apply to this output'::text;
  END IF;
  IF NEW.purpose = 'FOR_PRODUCTION' AND (dv.status NOT IN ('APPROVED', 'LOCKED') OR NEW.blocker_count > 0) THEN
    problems := problems || format('FOR_PRODUCTION requires an APPROVED or LOCKED design version and 0 BLOCKERs (design version is %s, %s BLOCKER(s))', dv.status, NEW.blocker_count);
  END IF;
  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION 'design_os.%: snapshot provenance rejected: %', TG_TABLE_NAME, array_to_string(problems, '; ') USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION design_os.check_issue() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
DECLARE
  s record;
  dv design_os.design_version%ROWTYPE;
BEGIN
  EXECUTE format('SELECT design_version_id, design_version_content_hash, blocker_count FROM design_os.%I WHERE id = $1 AND org_id = $2', TG_ARGV[0])
    INTO s USING NEW.snapshot_id, NEW.org_id;
  SELECT * INTO dv FROM design_os.design_version WHERE id = s.design_version_id AND org_id = NEW.org_id;
  IF dv.status IS DISTINCT FROM 'LOCKED' OR s.blocker_count > 0 OR s.design_version_content_hash <> dv.content_hash THEN
    RAISE EXCEPTION 'design_os.%: issuing requires a LOCKED design version, 0 BLOCKERs and a snapshot of the locked content', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION design_os.lock_cascade(p_subject_type text, p_id uuid, p_org uuid, p_actor uuid, p_reason text) RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  tbl regclass;
  st design_os.record_lifecycle_status;
  hash text;
  d record;
BEGIN
  SELECT version_table INTO tbl FROM design_os.versioned_table WHERE subject_type = p_subject_type;
  EXECUTE format('SELECT status, content_hash FROM %s WHERE id = $1 AND org_id = $2 FOR UPDATE', tbl) INTO st, hash USING p_id, p_org;
  IF st IS NULL THEN
    RAISE EXCEPTION 'lock: % % not found in this organization', p_subject_type, p_id USING ERRCODE = 'foreign_key_violation';
  ELSIF st IN ('DRAFT', 'IN_REVIEW') THEN
    RAISE EXCEPTION 'lock: dependency % % is % and cannot be locked', p_subject_type, p_id, st USING ERRCODE = 'integrity_constraint_violation';
  ELSIF st = 'APPROVED' THEN
    EXECUTE format('UPDATE %s SET status = ''LOCKED'', locked_by = $1, locked_at = now() WHERE id = $2 AND org_id = $3', tbl) USING p_actor, p_id, p_org;
    PERFORM design_os.record_decision(p_org, p_subject_type, p_id, 'LOCK', p_actor, p_reason, st, 'LOCKED', hash, NULL);
  END IF;
  FOR d IN SELECT * FROM design_os.version_dependencies(p_subject_type, p_id, p_org) WHERE dep_version_id IS NOT NULL LOOP
    PERFORM design_os.lock_cascade(d.dep_subject_type, d.dep_version_id, p_org, p_actor, p_reason);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION design_os.transition(p_subject_type text, p_id uuid, p_action text, p_reason text, p_expected_content_hash text DEFAULT NULL)
  RETURNS design_os.record_lifecycle_status
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
DECLARE
  actor uuid := design_os.current_user_id();
  org uuid := design_os.current_org_id();
  reg design_os.versioned_table%ROWTYPE;
  r jsonb;
  prev design_os.record_lifecycle_status;
  nxt design_os.record_lifecycle_status;
  submitted uuid;
  hash text;
  req uuid;
  problems text[];
  eff record;
BEGIN
  IF actor IS NULL OR org IS NULL THEN
    RAISE EXCEPTION 'transition: an authenticated, active member of the organization is required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT design_os.is_internal() THEN
    RAISE EXCEPTION 'transition: client identities cannot change lifecycles' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'transition: % requires a reason', p_action USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO reg FROM design_os.versioned_table WHERE subject_type = p_subject_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transition: unknown subject type %', p_subject_type USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Tenant-safe: another organization's version is indistinguishable from a missing one.
  EXECUTE format('SELECT to_jsonb(t) FROM %s t WHERE id = $1 AND org_id = $2 FOR UPDATE', reg.version_table) INTO r USING p_id, org;
  IF r IS NULL THEN
    RAISE EXCEPTION 'transition: % % not found', p_subject_type, p_id USING ERRCODE = 'no_data_found';
  END IF;
  prev := (r ->> 'status')::design_os.record_lifecycle_status;
  submitted := (r ->> 'submitted_by')::uuid;
  hash := r ->> 'content_hash';
  PERFORM set_config('design_os.reason', p_reason, true);

  IF p_action = 'SUBMIT' THEN
    IF prev <> 'DRAFT' THEN RAISE EXCEPTION 'transition: SUBMIT is allowed only from DRAFT (is %)', prev USING ERRCODE = 'check_violation'; END IF;
    IF NOT design_os.has_permission(reg.author_action) THEN RAISE EXCEPTION 'transition: missing permission %', reg.author_action USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_subject_type = 'design' AND NOT EXISTS (
        SELECT 1 FROM design_os.validation_run v WHERE v.design_version_id = p_id AND v.org_id = org
          AND v.input_hash = r ->> 'input_hash' AND v.input_revision = (r ->> 'input_revision')::int) THEN
      RAISE EXCEPTION 'transition: SUBMIT requires an engine validation run for the current inputs' USING ERRCODE = 'check_violation';
    END IF;
    nxt := 'IN_REVIEW';
    EXECUTE format('UPDATE %s SET status = $1, submitted_by = $2, submitted_at = now() WHERE id = $3', reg.version_table) USING nxt, actor, p_id;
    INSERT INTO design_os.approval_request (org_id, subject_type, subject_id, subject_content_hash, requested_by, requested_at)
    VALUES (org, p_subject_type, p_id, hash, actor, now()) RETURNING id INTO req;

  ELSIF p_action = 'REQUEST_CHANGES' THEN
    IF prev <> 'IN_REVIEW' THEN RAISE EXCEPTION 'transition: REQUEST_CHANGES is allowed only from IN_REVIEW (is %)', prev USING ERRCODE = 'check_violation'; END IF;
    IF NOT design_os.has_permission(reg.approve_action) THEN RAISE EXCEPTION 'transition: missing permission %', reg.approve_action USING ERRCODE = 'insufficient_privilege'; END IF;
    IF actor = submitted THEN RAISE EXCEPTION 'transition: the submitter cannot review their own submission' USING ERRCODE = 'insufficient_privilege'; END IF;
    nxt := 'DRAFT';
    EXECUTE format('UPDATE %s SET status = $1, submitted_by = NULL, submitted_at = NULL WHERE id = $2', reg.version_table) USING nxt, p_id;
    UPDATE design_os.approval_request SET status = 'CHANGES_REQUESTED', closed_at = now() WHERE subject_type = p_subject_type AND subject_id = p_id AND status = 'OPEN' RETURNING id INTO req;

  ELSIF p_action = 'APPROVE' THEN
    IF prev <> 'IN_REVIEW' THEN RAISE EXCEPTION 'transition: APPROVE is allowed only from IN_REVIEW (is %)', prev USING ERRCODE = 'check_violation'; END IF;
    IF NOT design_os.has_permission(reg.approve_action) THEN RAISE EXCEPTION 'transition: missing permission %', reg.approve_action USING ERRCODE = 'insufficient_privilege'; END IF;
    -- D8: mandatory, no override.
    IF actor = submitted THEN RAISE EXCEPTION 'transition: approver must differ from the submitter (D8)' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_expected_content_hash IS NULL OR p_expected_content_hash <> hash THEN
      RAISE EXCEPTION 'transition: the reviewed content hash does not match the stored content' USING ERRCODE = 'check_violation';
    END IF;
    problems := design_os.approval_problems(p_subject_type, p_id, org);
    IF cardinality(problems) > 0 THEN
      RAISE EXCEPTION 'transition: approval preconditions failed: %', array_to_string(problems, '; ') USING ERRCODE = 'check_violation';
    END IF;
    EXECUTE format('SELECT id, version_number, status, content_hash FROM %s WHERE org_id = $1 AND entity_id = $2 AND id <> $3 AND status IN (''APPROVED'', ''LOCKED'') ORDER BY version_number DESC LIMIT 1', reg.version_table)
      INTO eff USING org, (r ->> 'entity_id')::uuid, p_id;
    IF eff.id IS NOT NULL AND eff.version_number > (r ->> 'version_number')::int THEN
      RAISE EXCEPTION 'transition: a newer version (%) is already effective', eff.version_number USING ERRCODE = 'check_violation';
    END IF;
    nxt := 'APPROVED';
    EXECUTE format('UPDATE %s SET status = $1, approved_by = $2, approved_at = now(), effective_from = now() WHERE id = $3', reg.version_table) USING nxt, actor, p_id;
    UPDATE design_os.approval_request SET status = 'APPROVED', closed_at = now() WHERE subject_type = p_subject_type AND subject_id = p_id AND status = 'OPEN' RETURNING id INTO req;
    IF eff.id IS NOT NULL THEN
      EXECUTE format('UPDATE %s SET status = ''SUPERSEDED'', superseded_by = $1, superseded_at = now() WHERE id = $2', reg.version_table) USING p_id, eff.id;
      PERFORM design_os.record_decision(org, p_subject_type, eff.id, 'SUPERSEDE', actor, format('Superseded by version %s: %s', r ->> 'version_number', p_reason), eff.status, 'SUPERSEDED', eff.content_hash, NULL);
    END IF;

  ELSIF p_action = 'LOCK' THEN
    IF prev <> 'APPROVED' THEN RAISE EXCEPTION 'transition: LOCK is allowed only from APPROVED (is %)', prev USING ERRCODE = 'check_violation'; END IF;
    IF p_subject_type = 'design' THEN
      IF NOT (design_os.has_permission('design_version.lock') OR design_os.has_permission('quotation.issue') OR design_os.has_permission('drawing.issue') OR design_os.has_permission('manufacturing.release')) THEN
        RAISE EXCEPTION 'transition: missing permission to lock or issue design versions' USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF NOT design_os.has_permission(reg.approve_action) THEN
      RAISE EXCEPTION 'transition: missing permission %', reg.approve_action USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- Records the LOCK decision for this version and every newly locked dependency.
    PERFORM design_os.lock_cascade(p_subject_type, p_id, org, actor, p_reason);
    RETURN 'LOCKED';

  ELSE
    RAISE EXCEPTION 'transition: unknown action % (SUPERSEDE happens only when a successor is approved)', p_action USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM design_os.record_decision(org, p_subject_type, p_id, p_action, actor, p_reason, prev, nxt, hash, req);
  RETURN nxt;
END $$;

CREATE OR REPLACE FUNCTION design_os.forbid_truncate() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'design_os.%: TRUNCATE is not allowed', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$;

DROP TABLE design_os.error_code;
