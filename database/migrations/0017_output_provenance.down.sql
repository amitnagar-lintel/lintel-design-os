-- Revert 0017: restore the 0016 output / provenance model exactly (function bodies as they were after 0016).
SET LOCAL ROLE design_os_owner;

DROP TRIGGER lock_issued_commercial_versions ON design_os.quotation_issue;
DROP FUNCTION design_os.lock_issued_commercial_versions();
DROP TRIGGER check_drawing_manifest ON design_os.drawing_snapshot;
DROP TRIGGER check_drawing_manifest ON design_os.drawing_snapshot_file;
DROP FUNCTION design_os.check_drawing_manifest();
DROP FUNCTION design_os.drawing_file_manifest_hash(uuid);
DROP TRIGGER check_snapshot_file ON design_os.drawing_snapshot_file;
DROP FUNCTION design_os.check_snapshot_file();
ALTER TABLE design_os.drawing_snapshot_file DROP CONSTRAINT drawing_snapshot_file_unique, DROP CONSTRAINT drawing_snapshot_file_format_fk,
  DROP CONSTRAINT drawing_snapshot_file_pkey, DROP COLUMN sequence, DROP COLUMN sheet_index,
  ADD CONSTRAINT drawing_snapshot_file_format_check CHECK (format IN ('SVG', 'PDF')), ADD CONSTRAINT drawing_snapshot_file_pkey PRIMARY KEY (snapshot_id, format);

DROP TRIGGER check_output_run_referenced ON design_os.validation_run;
DROP FUNCTION design_os.check_output_run_referenced();
DROP TRIGGER check_snapshot_sources ON design_os.boq_snapshot;
DROP TRIGGER check_snapshot_sources ON design_os.pricing_snapshot;
DROP TRIGGER check_snapshot_sources ON design_os.quotation_snapshot;
DROP FUNCTION design_os.check_snapshot_sources();
CREATE OR REPLACE FUNCTION design_os.check_snapshot_provenance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'design_os', 'pg_temp'
AS $function$
DECLARE
  dv design_os.design_version%ROWTYPE;
  problems text[] := ARRAY[]::text[];
  production_problems integer := 0;
  purpose_problems integer := 0;
  rule design_os.output_purpose_rule%ROWTYPE;
  code text;
BEGIN
  SELECT * INTO dv FROM design_os.design_version WHERE id = NEW.design_version_id AND org_id = NEW.org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'design_os.%: design version % not found in this organization', TG_TABLE_NAME, NEW.design_version_id USING ERRCODE = 'LD005';
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
    production_problems := 1;
    problems := problems || format('FOR_PRODUCTION requires an APPROVED or LOCKED design version and 0 BLOCKERs (design version is %s, %s BLOCKER(s))', dv.status, NEW.blocker_count);
  END IF;
  -- Output purpose (PRELIMINARY / FOR_REVIEW / FOR_PRODUCTION): allowed per snapshot kind and design lifecycle state by
  -- design_os.output_purpose_rule. FOR_PRODUCTION keeps its explicit guard above; the rule table can only tighten it.
  SELECT * INTO rule FROM design_os.output_purpose_rule WHERE kind = NEW.kind AND purpose = NEW.purpose;
  IF NOT FOUND THEN
    purpose_problems := 1;
    problems := problems || format('purpose %s is not allowed for %s outputs', NEW.purpose, NEW.kind);
  ELSIF production_problems = 0 AND NOT (dv.status = ANY (rule.design_statuses)) THEN
    purpose_problems := 1;
    problems := problems || format('%s requires a design version that is %s (design version is %s)', NEW.purpose, array_to_string(rule.design_statuses, ' / '), dv.status);
  ELSIF production_problems = 0 AND rule.requires_zero_blockers AND NEW.blocker_count > 0 THEN
    production_problems := 1;
    problems := problems || format('%s requires 0 BLOCKERs (%s BLOCKER(s))', NEW.purpose, NEW.blocker_count);
  END IF;
  IF cardinality(problems) > 0 THEN
    -- Pin / hash mismatches are provenance errors; then the purpose rule; then the FOR_PRODUCTION guard (design state, then BLOCKERs).
    code := CASE WHEN cardinality(problems) > production_problems + purpose_problems THEN 'LD016'
                 WHEN purpose_problems > 0 THEN 'LD024'
                 WHEN dv.status NOT IN ('APPROVED', 'LOCKED') THEN 'LD021'
                 ELSE 'LD011' END;
    RAISE EXCEPTION 'design_os.%: snapshot provenance rejected: %', TG_TABLE_NAME, array_to_string(problems, '; ')
      USING ERRCODE = code, DETAIL = jsonb_build_object('problems', to_jsonb(problems), 'purpose', NEW.purpose, 'blockerCount', NEW.blocker_count)::text;
  END IF;
  RETURN NEW;
END $function$;

DROP INDEX design_os.bom_snapshot_identity, design_os.boq_snapshot_identity, design_os.pricing_snapshot_identity, design_os.quotation_snapshot_identity,
  design_os.drawing_snapshot_identity, design_os.manufacturing_document_snapshot_identity;
ALTER TABLE design_os.drawing_snapshot DROP CONSTRAINT drawing_snapshot_type_check, DROP CONSTRAINT drawing_snapshot_scope, DROP CONSTRAINT drawing_snapshot_wall,
  DROP CONSTRAINT drawing_snapshot_object, DROP CONSTRAINT drawing_snapshot_cut, DROP COLUMN drawing_scope, DROP COLUMN wall_id, DROP COLUMN object_lineage_id,
  DROP COLUMN cut_x_mm, DROP COLUMN drawing_number, DROP COLUMN drawing_revision, DROP COLUMN file_manifest_hash, ALTER COLUMN drawing_type SET DEFAULT 'FRONT_ELEVATION';
ALTER TABLE design_os.quotation_snapshot DROP CONSTRAINT quotation_snapshot_revision_unique, DROP COLUMN boq_snapshot_id, DROP COLUMN pricing_snapshot_id;
ALTER TABLE design_os.pricing_snapshot DROP COLUMN bom_snapshot_id, DROP COLUMN boq_snapshot_id;
ALTER TABLE design_os.boq_snapshot DROP COLUMN bom_snapshot_id;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bom_snapshot', 'boq_snapshot', 'pricing_snapshot', 'quotation_snapshot', 'drawing_snapshot', 'manufacturing_document_snapshot']::text[] LOOP
    EXECUTE format('ALTER TABLE design_os.%1$I DROP CONSTRAINT %1$s_commercial_input, DROP CONSTRAINT %1$s_validation_run_fk, DROP COLUMN input_revision,
      DROP COLUMN dependency_hashes, DROP COLUMN dependency_set_hash, DROP COLUMN commercial_input_hash, DROP COLUMN validation_run_id, DROP COLUMN engine_name,
      DROP COLUMN engine_build, DROP COLUMN engine_fingerprint, DROP COLUMN engine_closure, DROP COLUMN warning_count, DROP COLUMN output_complete', t);
    EXECUTE format('ALTER TABLE design_os.%1$I RENAME COLUMN engine_seal TO engine_hash', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION design_os.approval_problem_items(p_subject_type text, p_id uuid, p_org uuid)
 RETURNS TABLE(problem_code text, problem_message text)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  d record;
  st design_os.record_lifecycle_status;
  dv design_os.design_version%ROWTYPE;
  run design_os.validation_run%ROWTYPE;
BEGIN
  -- Every dependency must be APPROVED or LOCKED (SUPERSEDED, DRAFT, IN_REVIEW never satisfy approval).
  FOR d IN SELECT * FROM design_os.version_dependencies(p_subject_type, p_id, p_org) LOOP
    IF d.dep_version_id IS NULL THEN
      IF d.required THEN RETURN QUERY SELECT 'PIN_NOT_SET', format('pin %s is not set', d.name); END IF;
      CONTINUE;
    END IF;
    st := design_os.version_status(d.dep_subject_type, d.dep_version_id, p_org);
    IF st IS NULL THEN
      RETURN QUERY SELECT 'DEPENDENCY_NOT_FOUND', format('%s %s not found in this organization', d.name, d.dep_version_id);
    ELSIF st NOT IN ('APPROVED', 'LOCKED') THEN
      RETURN QUERY SELECT 'DEPENDENCY_NOT_APPROVED', format('%s %s is %s; it must be APPROVED or LOCKED', d.name, d.dep_version_id, st);
    END IF;
  END LOOP;

  IF p_subject_type = 'design' THEN
    -- Only the latest immutable engine run for exactly the current inputs (input_hash AND database input_revision) counts.
    SELECT * INTO dv FROM design_os.design_version WHERE id = p_id AND org_id = p_org;
    SELECT * INTO run FROM design_os.validation_run
      WHERE design_version_id = p_id AND org_id = p_org AND input_hash = dv.input_hash AND input_revision = dv.input_revision
      ORDER BY seq DESC LIMIT 1;
    IF NOT FOUND THEN RETURN QUERY SELECT 'VALIDATION_RUN_REQUIRED', 'no engine validation run exists for the current inputs'::text;
    ELSIF run.blocker_count > 0 THEN RETURN QUERY SELECT 'VALIDATION_BLOCKERS', format('engine validation has %s BLOCKER(s)', run.blocker_count);
    END IF;
  ELSIF p_subject_type = 'construction_standard' THEN
    RETURN QUERY SELECT 'CONTENT_INCOMPLETE', format('construction value %s is missing', c.code) FROM design_os.construction_variable c
                        WHERE NOT EXISTS (SELECT 1 FROM design_os.construction_standard_value v WHERE v.version_id = p_id AND v.variable_code = c.code) ORDER BY c.code;
    RETURN QUERY SELECT 'CONTENT_INCOMPLETE', format('construction value %s is NULL / UNVERIFIED or has no source', v.variable_code) FROM design_os.construction_standard_value v
                        WHERE v.version_id = p_id AND (v.value IS NULL OR v.source IS NULL) ORDER BY v.variable_code;
  ELSIF p_subject_type = 'planning_standard' THEN
    RETURN QUERY SELECT 'CONTENT_INCOMPLETE', format('planning value %s is missing', c.code) FROM design_os.planning_variable c
                        WHERE NOT EXISTS (SELECT 1 FROM design_os.planning_standard_value v WHERE v.version_id = p_id AND v.variable_code = c.code) ORDER BY c.code;
    RETURN QUERY SELECT 'CONTENT_INCOMPLETE', format('planning value %s is NULL / UNVERIFIED or has no source', v.variable_code) FROM design_os.planning_standard_value v
                        WHERE v.version_id = p_id AND (v.value IS NULL OR v.source IS NULL) ORDER BY v.variable_code;
  ELSIF p_subject_type = 'manufacturing_standard' THEN
    -- Not approvable (and therefore not usable for approved designs) until its variable/value model is defined.
    IF NOT EXISTS (SELECT 1 FROM design_os.manufacturing_variable) THEN
      RETURN QUERY SELECT 'MODEL_UNDEFINED', 'ManufacturingStandard has no defined variable model yet; it cannot be approved until its variables are defined'::text;
    END IF;
    RETURN QUERY SELECT 'CONTENT_INCOMPLETE', format('manufacturing value %s is missing', c.code) FROM design_os.manufacturing_variable c
                        WHERE NOT EXISTS (SELECT 1 FROM design_os.manufacturing_standard_value v WHERE v.version_id = p_id AND v.variable_code = c.code) ORDER BY c.code;
    RETURN QUERY SELECT 'CONTENT_INCOMPLETE', format('manufacturing value %s is NULL / UNVERIFIED or has no source', v.variable_code) FROM design_os.manufacturing_standard_value v
                        WHERE v.version_id = p_id AND (v.value IS NULL OR v.source IS NULL) ORDER BY v.variable_code;
  ELSIF p_subject_type = 'edge_band_standard' THEN
    -- At least one rule set; every rule set defines at least one component type (an empty rule set = rules not yet defined);
    -- every banded edge references an edge band that has an APPROVED or LOCKED version.
    IF NOT EXISTS (SELECT 1 FROM design_os.edge_band_rule r WHERE r.version_id = p_id) THEN
      RETURN QUERY SELECT 'CONTENT_INCOMPLETE', 'EdgeBandStandard has no edge rules'::text;
    END IF;
    RETURN QUERY SELECT 'CONTENT_INCOMPLETE', format('edge rule set %s has no edge rules', rs.rule_set_code) FROM design_os.edge_band_rule_set rs
                        WHERE rs.version_id = p_id AND NOT EXISTS (SELECT 1 FROM design_os.edge_band_rule r WHERE r.version_id = p_id AND r.rule_set_code = rs.rule_set_code)
                        ORDER BY rs.rule_set_code;
    RETURN QUERY SELECT DISTINCT 'DEPENDENCY_NOT_APPROVED', format('edge band %s has no APPROVED or LOCKED version', r.edge_band_id) FROM design_os.edge_band_rule r
                        WHERE r.version_id = p_id AND r.edge_band_id IS NOT NULL AND NOT EXISTS (
                          SELECT 1 FROM design_os.edge_band e JOIN design_os.edge_band_version v ON v.entity_id = e.id AND v.org_id = e.org_id
                          WHERE e.org_id = p_org AND e.code = r.edge_band_id AND v.status IN ('APPROVED', 'LOCKED'));
  ELSIF p_subject_type = 'pricing_standard' THEN
    IF EXISTS (SELECT 1 FROM design_os.pricing_standard_version p WHERE p.id = p_id AND (p.manufacturing_cost_formula IS NULL OR p.wastage_board_pct IS NULL OR p.wastage_edge_band_pct IS NULL
        OR p.wastage_finish_pct IS NULL OR p.overhead_pct IS NULL OR p.margin_basis IS NULL OR p.margin_pct IS NULL OR p.gst_pct IS NULL)) THEN
      RETURN QUERY SELECT 'CONTENT_INCOMPLETE', 'pricing rules contain NULL / UNVERIFIED values'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM design_os.rate_card_line l WHERE l.version_id = p_id) THEN RETURN QUERY SELECT 'CONTENT_INCOMPLETE', 'rate card has no rates'::text; END IF;
    RETURN QUERY SELECT 'CONTENT_INCOMPLETE', format('rate %s %s is NULL / UNVERIFIED', l.measure, l.item_key) FROM design_os.rate_card_line l WHERE l.version_id = p_id AND l.rate_paise IS NULL ORDER BY l.measure, l.item_key;
  ELSIF p_subject_type = 'quotation_policy' THEN
    IF EXISTS (SELECT 1 FROM design_os.quotation_policy_version q WHERE q.id = p_id AND (q.tax_policy IS NULL OR q.tax_rounding_mode IS NULL OR q.grand_total_rounding_mode IS NULL OR q.discount_mode IS NULL)) THEN
      RETURN QUERY SELECT 'CONTENT_INCOMPLETE', 'quotation policy contains NULL / UNVERIFIED fields'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM design_os.tax_rate t WHERE t.version_id = p_id) THEN RETURN QUERY SELECT 'CONTENT_INCOMPLETE', 'quotation policy has no tax rates'::text; END IF;
    IF NOT EXISTS (SELECT 1 FROM design_os.tax_rate_mapping m WHERE m.version_id = p_id) THEN RETURN QUERY SELECT 'CONTENT_INCOMPLETE', 'quotation policy maps no product category to a tax rate'::text; END IF;
    RETURN QUERY SELECT 'CONTENT_INCOMPLETE', format('tax rate %s is NULL / UNVERIFIED', t.rate_code) FROM design_os.tax_rate t WHERE t.version_id = p_id AND t.percent IS NULL ORDER BY t.rate_code;
    RETURN QUERY SELECT 'CONTENT_INCOMPLETE', format('tax mapping for %s is NULL / UNVERIFIED', m.product_category) FROM design_os.tax_rate_mapping m WHERE m.version_id = p_id AND m.rate_code IS NULL ORDER BY m.product_category;
  ELSIF p_subject_type = 'hettich_dataset' THEN
    -- Source-verification STATE of the records (the full record validation stays in the TypeScript Hettich engine).
    IF NOT EXISTS (SELECT 1 FROM design_os.hettich_article a WHERE a.version_id = p_id) THEN
      RETURN QUERY SELECT 'CONTENT_INCOMPLETE', 'Hettich dataset has no articles'::text;
    END IF;
    RETURN QUERY SELECT 'SOURCE_UNVERIFIED', format('Hettich record %s is not source-verified', a.record_code) FROM design_os.hettich_article a
                        WHERE a.version_id = p_id AND (btrim(coalesce(a.article_number, '')) = '' OR a.category IS NULL
                          OR NOT design_os.is_official_hettich_url(a.source_ref ->> 'url') OR coalesce(a.source_ref ->> 'sourceDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
                          OR a.verified_by IS NULL OR a.verified_at IS NULL)
                        ORDER BY a.record_code;
    RETURN QUERY SELECT 'SOURCE_UNVERIFIED', format('Hettich record %s is a fixture article', a.record_code) FROM design_os.hettich_article a
                        WHERE a.version_id = p_id AND a.article_number LIKE 'FIXTURE-%' ORDER BY a.record_code;
    RETURN QUERY SELECT 'SOURCE_UNVERIFIED', format('Hettich record %s licence is %s', a.record_code, a.licence_status) FROM design_os.hettich_article a
                        WHERE a.version_id = p_id AND a.licence_status NOT IN ('OFFICIAL_PUBLIC', 'AUTHORISED') ORDER BY a.record_code;
    RETURN QUERY SELECT 'SOURCE_UNVERIFIED', format('Hettich calculation rule %s is not source-verified', r.rule_code) FROM design_os.hettich_calculation_rule r
                        WHERE r.version_id = p_id AND (NOT design_os.is_official_hettich_url(r.source_ref ->> 'url')
                          OR r.verification ->> 'verifiedBy' IS NULL OR r.verification ->> 'verifiedAt' IS NULL)
                        ORDER BY r.rule_code;
    RETURN QUERY SELECT DISTINCT 'CONTENT_INCOMPLETE', format('Hettich hinge family %s has no calculation rule', a.product_family) FROM design_os.hettich_article a
                        WHERE a.version_id = p_id AND a.category = 'HINGE' AND NOT EXISTS (
                          SELECT 1 FROM design_os.hettich_calculation_rule r WHERE r.version_id = p_id AND r.category = 'HINGE' AND r.family = a.product_family);
  ELSIF p_subject_type IN ('material_catalog', 'finish_catalog', 'hardware_catalog', 'appliance_catalog', 'product_catalog') THEN
    -- A catalog version must list at least one exact item version of its domain.
    IF NOT EXISTS (SELECT 1 FROM design_os.version_dependencies(p_subject_type, p_id, p_org)) THEN
      RETURN QUERY SELECT 'CONTENT_INCOMPLETE', format('%s version has no items', p_subject_type);
    END IF;
  END IF;
  RETURN;
END $function$;

CREATE OR REPLACE FUNCTION design_os.transition(p_subject_type text, p_id uuid, p_action text, p_reason text, p_expected_content_hash text DEFAULT NULL::text)
 RETURNS design_os.record_lifecycle_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'design_os', 'pg_temp'
AS $function$
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
  items jsonb;
  problem_code text;
  eff record;
BEGIN
  IF actor IS NULL OR org IS NULL THEN
    RAISE EXCEPTION 'transition: an authenticated, active member of the organization is required' USING ERRCODE = 'LD002';
  END IF;
  IF NOT design_os.is_internal() THEN
    RAISE EXCEPTION 'transition: client identities cannot change lifecycles' USING ERRCODE = 'LD003';
  END IF;
  IF btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'transition: % requires a reason', p_action USING ERRCODE = 'LD020';
  END IF;
  SELECT * INTO reg FROM design_os.versioned_table WHERE subject_type = p_subject_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transition: unknown subject type %', p_subject_type USING ERRCODE = 'LD020';
  END IF;
  -- Tenant-safe: another organization's version is indistinguishable from a missing one.
  EXECUTE format('SELECT to_jsonb(t) FROM %s t WHERE id = $1 AND org_id = $2 FOR UPDATE', reg.version_table) INTO r USING p_id, org;
  IF r IS NULL THEN
    RAISE EXCEPTION 'transition: % % not found', p_subject_type, p_id USING ERRCODE = 'LD005';
  END IF;
  prev := (r ->> 'status')::design_os.record_lifecycle_status;
  submitted := (r ->> 'submitted_by')::uuid;
  hash := r ->> 'content_hash';
  PERFORM set_config('design_os.reason', p_reason, true);

  IF p_action = 'SUBMIT' THEN
    IF prev <> 'DRAFT' THEN RAISE EXCEPTION 'transition: SUBMIT is allowed only from DRAFT (is %)', prev USING ERRCODE = 'LD006', DETAIL = jsonb_build_object('status', prev)::text; END IF;
    IF NOT design_os.has_permission(reg.author_action) THEN RAISE EXCEPTION 'transition: missing permission %', reg.author_action USING ERRCODE = 'LD001'; END IF;
    IF p_subject_type = 'design' AND NOT EXISTS (
        SELECT 1 FROM design_os.validation_run v WHERE v.design_version_id = p_id AND v.org_id = org
          AND v.input_hash = r ->> 'input_hash' AND v.input_revision = (r ->> 'input_revision')::int) THEN
      RAISE EXCEPTION 'transition: SUBMIT requires an engine validation run for the current inputs' USING ERRCODE = 'LD010';
    END IF;
    nxt := 'IN_REVIEW';
    EXECUTE format('UPDATE %s SET status = $1, submitted_by = $2, submitted_at = now() WHERE id = $3', reg.version_table) USING nxt, actor, p_id;
    INSERT INTO design_os.approval_request (org_id, subject_type, subject_id, subject_content_hash, requested_by, requested_at)
    VALUES (org, p_subject_type, p_id, hash, actor, now()) RETURNING id INTO req;

  ELSIF p_action = 'REQUEST_CHANGES' THEN
    IF prev <> 'IN_REVIEW' THEN RAISE EXCEPTION 'transition: REQUEST_CHANGES is allowed only from IN_REVIEW (is %)', prev USING ERRCODE = 'LD006', DETAIL = jsonb_build_object('status', prev)::text; END IF;
    IF NOT design_os.has_permission(reg.approve_action) THEN RAISE EXCEPTION 'transition: missing permission %', reg.approve_action USING ERRCODE = 'LD001'; END IF;
    IF actor = submitted THEN RAISE EXCEPTION 'transition: the submitter cannot review their own submission' USING ERRCODE = 'LD004'; END IF;
    nxt := 'DRAFT';
    EXECUTE format('UPDATE %s SET status = $1, submitted_by = NULL, submitted_at = NULL WHERE id = $2', reg.version_table) USING nxt, p_id;
    UPDATE design_os.approval_request SET status = 'CHANGES_REQUESTED', closed_at = now() WHERE subject_type = p_subject_type AND subject_id = p_id AND status = 'OPEN' RETURNING id INTO req;

  ELSIF p_action = 'APPROVE' THEN
    IF prev <> 'IN_REVIEW' THEN RAISE EXCEPTION 'transition: APPROVE is allowed only from IN_REVIEW (is %)', prev USING ERRCODE = 'LD006', DETAIL = jsonb_build_object('status', prev)::text; END IF;
    IF NOT design_os.has_permission(reg.approve_action) THEN RAISE EXCEPTION 'transition: missing permission %', reg.approve_action USING ERRCODE = 'LD001'; END IF;
    -- D8: mandatory, no override.
    IF actor = submitted THEN RAISE EXCEPTION 'transition: approver must differ from the submitter (D8)' USING ERRCODE = 'LD004'; END IF;
    IF p_expected_content_hash IS NULL OR p_expected_content_hash <> hash THEN
      RAISE EXCEPTION 'transition: the reviewed content hash does not match the stored content' USING ERRCODE = 'LD007';
    END IF;
    SELECT jsonb_agg(jsonb_build_object('code', i.problem_code, 'message', i.problem_message) ORDER BY i.n) INTO items
      FROM design_os.approval_problem_items(p_subject_type, p_id, org) WITH ORDINALITY AS i(problem_code, problem_message, n);
    IF items IS NOT NULL THEN
      -- The most specific reason decides the code; every item is listed in DETAIL.
      problem_code := CASE
        WHEN jsonb_path_exists(items, '$[*] ? (@.code == "PIN_NOT_SET" || @.code == "DEPENDENCY_NOT_FOUND" || @.code == "DEPENDENCY_NOT_APPROVED")') THEN 'LD008'
        WHEN jsonb_path_exists(items, '$[*] ? (@.code == "VALIDATION_RUN_REQUIRED")') THEN 'LD010'
        WHEN jsonb_path_exists(items, '$[*] ? (@.code == "VALIDATION_BLOCKERS")') THEN 'LD011'
        ELSE 'LD009' END;
      RAISE EXCEPTION 'transition: approval preconditions failed: %', (SELECT string_agg(e ->> 'message', '; ' ORDER BY n) FROM jsonb_array_elements(items) WITH ORDINALITY AS x(e, n))
        USING ERRCODE = problem_code, DETAIL = jsonb_build_object('problems', items)::text;
    END IF;
    EXECUTE format('SELECT id, version_number, status, content_hash FROM %s WHERE org_id = $1 AND entity_id = $2 AND id <> $3 AND status IN (''APPROVED'', ''LOCKED'') ORDER BY version_number DESC LIMIT 1', reg.version_table)
      INTO eff USING org, (r ->> 'entity_id')::uuid, p_id;
    IF eff.id IS NOT NULL AND eff.version_number > (r ->> 'version_number')::int THEN
      RAISE EXCEPTION 'transition: a newer version (%) is already effective', eff.version_number USING ERRCODE = 'LD006', DETAIL = jsonb_build_object('effectiveVersion', eff.version_number)::text;
    END IF;
    nxt := 'APPROVED';
    EXECUTE format('UPDATE %s SET status = $1, approved_by = $2, approved_at = now(), effective_from = now() WHERE id = $3', reg.version_table) USING nxt, actor, p_id;
    UPDATE design_os.approval_request SET status = 'APPROVED', closed_at = now() WHERE subject_type = p_subject_type AND subject_id = p_id AND status = 'OPEN' RETURNING id INTO req;
    IF eff.id IS NOT NULL THEN
      EXECUTE format('UPDATE %s SET status = ''SUPERSEDED'', superseded_by = $1, superseded_at = now() WHERE id = $2', reg.version_table) USING p_id, eff.id;
      PERFORM design_os.record_decision(org, p_subject_type, eff.id, 'SUPERSEDE', actor, format('Superseded by version %s: %s', r ->> 'version_number', p_reason), eff.status, 'SUPERSEDED', eff.content_hash, NULL);
    END IF;

  ELSIF p_action = 'LOCK' THEN
    IF prev <> 'APPROVED' THEN RAISE EXCEPTION 'transition: LOCK is allowed only from APPROVED (is %)', prev USING ERRCODE = 'LD006', DETAIL = jsonb_build_object('status', prev)::text; END IF;
    IF p_subject_type = 'design' THEN
      IF NOT (design_os.has_permission('design_version.lock') OR design_os.has_permission('quotation.issue') OR design_os.has_permission('drawing.issue') OR design_os.has_permission('manufacturing.release')) THEN
        RAISE EXCEPTION 'transition: missing permission to lock or issue design versions' USING ERRCODE = 'LD001';
      END IF;
    ELSIF NOT design_os.has_permission(reg.approve_action) THEN
      RAISE EXCEPTION 'transition: missing permission %', reg.approve_action USING ERRCODE = 'LD001';
    END IF;
    -- Records the LOCK decision for this version and every newly locked dependency.
    PERFORM design_os.lock_cascade(p_subject_type, p_id, org, actor, p_reason);
    RETURN 'LOCKED';

  ELSE
    RAISE EXCEPTION 'transition: unknown action % (SUPERSEDE happens only when a successor is approved)', p_action USING ERRCODE = 'LD020';
  END IF;

  PERFORM design_os.record_decision(org, p_subject_type, p_id, p_action, actor, p_reason, prev, nxt, hash, req);
  RETURN nxt;
END $function$;

DROP FUNCTION design_os.record_validation_run(text, uuid, text, text, text, text, text, jsonb, integer, integer, jsonb, text);
CREATE OR REPLACE FUNCTION design_os.record_validation_run(p_design_version_id uuid, p_input_hash text, p_engine_version text, p_engine_build text, p_engine_hash text, p_blocker_count integer, p_warning_count integer, p_messages jsonb, p_content_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'design_os', 'pg_temp'
AS $function$
DECLARE
  actor uuid := design_os.current_user_id();
  org uuid := design_os.current_org_id();
  dv design_os.design_version%ROWTYPE;
  run_id uuid;
BEGIN
  IF actor IS NULL OR org IS NULL THEN
    RAISE EXCEPTION 'record_validation_run: an authenticated internal member of the organization is required' USING ERRCODE = 'LD002';
  END IF;
  IF NOT design_os.is_internal() THEN
    RAISE EXCEPTION 'record_validation_run: an authenticated internal member of the organization is required' USING ERRCODE = 'LD003';
  END IF;
  IF NOT (design_os.has_permission('output.generate.engineering') OR design_os.has_permission('design_version.author')) THEN
    RAISE EXCEPTION 'record_validation_run: missing permission to record engine validation runs' USING ERRCODE = 'LD001';
  END IF;
  SELECT * INTO dv FROM design_os.design_version WHERE id = p_design_version_id AND org_id = org FOR SHARE;
  IF NOT FOUND OR NOT design_os.can_access_project(dv.project_id) THEN
    RAISE EXCEPTION 'record_validation_run: design version % not found', p_design_version_id USING ERRCODE = 'LD005';
  END IF;
  IF dv.status NOT IN ('DRAFT', 'IN_REVIEW') THEN
    RAISE EXCEPTION 'record_validation_run: design version is %; runs are recorded only for DRAFT or IN_REVIEW versions', dv.status USING ERRCODE = 'LD012', DETAIL = jsonb_build_object('status', dv.status)::text;
  END IF;
  IF p_input_hash IS DISTINCT FROM dv.input_hash THEN
    RAISE EXCEPTION 'record_validation_run: the run is for different inputs than the design version''s current input_hash' USING ERRCODE = 'LD012';
  END IF;
  INSERT INTO design_os.validation_run (org_id, design_version_id, input_hash, input_revision, engine_version, engine_build, engine_hash, content_hash, blocker_count, warning_count, messages, created_by, created_at)
  VALUES (org, dv.id, dv.input_hash, dv.input_revision, p_engine_version, p_engine_build, p_engine_hash, p_content_hash, p_blocker_count, p_warning_count, p_messages, actor, now())
  RETURNING id INTO run_id;
  RETURN run_id;
END $function$;

REVOKE ALL ON FUNCTION design_os.record_validation_run(uuid, text, text, text, text, integer, integer, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION design_os.record_validation_run(uuid, text, text, text, text, integer, integer, jsonb, text) TO design_os_api;
DROP INDEX design_os.validation_run_output_identity;
ALTER TABLE design_os.validation_run DROP CONSTRAINT validation_run_provenance_required, DROP CONSTRAINT validation_run_org_id_unique,
  DROP COLUMN purpose, DROP COLUMN engine_name, DROP COLUMN engine_closure, DROP COLUMN dependency_set_hash;
ALTER TABLE design_os.validation_run RENAME CONSTRAINT validation_run_engine_fingerprint_check TO validation_run_engine_hash_check;
ALTER TABLE design_os.validation_run RENAME COLUMN engine_fingerprint TO engine_hash;

ALTER TABLE design_os.design_version ADD COLUMN manufacturing_standard_version_id uuid, ADD COLUMN pricing_standard_version_id uuid,
  ADD COLUMN quotation_policy_version_id uuid,
  ADD CONSTRAINT design_version_manufacturing_fk FOREIGN KEY (org_id, manufacturing_standard_version_id) REFERENCES design_os.manufacturing_standard_version (org_id, id),
  ADD CONSTRAINT design_version_pricing_fk FOREIGN KEY (org_id, pricing_standard_version_id) REFERENCES design_os.pricing_standard_version (org_id, id),
  ADD CONSTRAINT design_version_quotation_policy_fk FOREIGN KEY (org_id, quotation_policy_version_id) REFERENCES design_os.quotation_policy_version (org_id, id);
GRANT UPDATE (manufacturing_standard_version_id, pricing_standard_version_id, quotation_policy_version_id) ON design_os.design_version TO design_os_api;
CREATE OR REPLACE FUNCTION design_os.maintain_input_revision()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.input_revision := 1;
  ELSIF (NEW.room_revision_id, NEW.construction_standard_version_id, NEW.planning_standard_version_id, NEW.edge_band_standard_version_id,
         NEW.manufacturing_standard_version_id, NEW.pricing_standard_version_id, NEW.quotation_policy_version_id, NEW.material_catalog_version_id,
         NEW.finish_catalog_version_id, NEW.hardware_catalog_version_id, NEW.appliance_catalog_version_id, NEW.product_catalog_version_id,
         NEW.hettich_dataset_version_id, NEW.input_hash)
     IS DISTINCT FROM
        (OLD.room_revision_id, OLD.construction_standard_version_id, OLD.planning_standard_version_id, OLD.edge_band_standard_version_id,
         OLD.manufacturing_standard_version_id, OLD.pricing_standard_version_id, OLD.quotation_policy_version_id, OLD.material_catalog_version_id,
         OLD.finish_catalog_version_id, OLD.hardware_catalog_version_id, OLD.appliance_catalog_version_id, OLD.product_catalog_version_id,
         OLD.hettich_dataset_version_id, OLD.input_hash) THEN
    NEW.input_revision := OLD.input_revision + 1;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION design_os.version_dependencies(p_subject_type text, p_id uuid, p_org uuid)
 RETURNS TABLE(dep_subject_type text, dep_version_id uuid, name text, required boolean)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  dv design_os.design_version%ROWTYPE;
BEGIN
  IF p_subject_type = 'design' THEN
    SELECT * INTO dv FROM design_os.design_version WHERE id = p_id AND org_id = p_org;
    RETURN QUERY SELECT * FROM (VALUES
      ('construction_standard', dv.construction_standard_version_id, 'constructionStandardVersionId', true),
      ('planning_standard', dv.planning_standard_version_id, 'planningStandardVersionId', true),
      ('edge_band_standard', dv.edge_band_standard_version_id, 'edgeBandStandardVersionId', true),
      ('manufacturing_standard', dv.manufacturing_standard_version_id, 'manufacturingStandardVersionId', false),
      ('pricing_standard', dv.pricing_standard_version_id, 'pricingStandardVersionId', false),
      ('quotation_policy', dv.quotation_policy_version_id, 'quotationPolicyVersionId', false),
      ('material_catalog', dv.material_catalog_version_id, 'materialCatalogVersionId', true),
      ('finish_catalog', dv.finish_catalog_version_id, 'finishCatalogVersionId', true),
      ('hardware_catalog', dv.hardware_catalog_version_id, 'hardwareCatalogVersionId', true),
      ('appliance_catalog', dv.appliance_catalog_version_id, 'applianceCatalogVersionId', false),
      ('product_catalog', dv.product_catalog_version_id, 'productCatalogVersionId', true),
      ('hettich_dataset', dv.hettich_dataset_version_id, 'hettichDatasetVersionId', true)
    ) AS d(t, v, n, r);
  ELSIF p_subject_type = 'material_catalog' THEN
    RETURN QUERY SELECT 'material'::text, m.material_version_id, 'material'::text, true FROM design_os.material_catalog_version_material m WHERE m.catalog_version_id = p_id AND m.org_id = p_org
      UNION ALL SELECT 'edge_band'::text, e.edge_band_version_id, 'edge_band'::text, true FROM design_os.material_catalog_version_edge_band e WHERE e.catalog_version_id = p_id AND e.org_id = p_org;
  ELSIF p_subject_type = 'finish_catalog' THEN
    RETURN QUERY SELECT 'finish'::text, m.finish_version_id, 'finish'::text, true FROM design_os.finish_catalog_version_finish m WHERE m.catalog_version_id = p_id AND m.org_id = p_org;
  ELSIF p_subject_type = 'hardware_catalog' THEN
    RETURN QUERY SELECT 'hardware_item'::text, m.hardware_item_version_id, 'hardware_item'::text, true FROM design_os.hardware_catalog_version_hardware_item m WHERE m.catalog_version_id = p_id AND m.org_id = p_org
      UNION ALL SELECT 'hardware_rule_set'::text, r.hardware_rule_set_version_id, 'hardware_rule_set'::text, true FROM design_os.hardware_catalog_version_hardware_rule_set r WHERE r.catalog_version_id = p_id AND r.org_id = p_org;
  ELSIF p_subject_type = 'appliance_catalog' THEN
    RETURN QUERY SELECT 'appliance'::text, m.appliance_version_id, 'appliance'::text, true FROM design_os.appliance_catalog_version_appliance m WHERE m.catalog_version_id = p_id AND m.org_id = p_org;
  ELSIF p_subject_type = 'product_catalog' THEN
    RETURN QUERY SELECT 'product'::text, m.product_version_id, 'product'::text, true FROM design_os.product_catalog_version_product m WHERE m.catalog_version_id = p_id AND m.org_id = p_org;
  ELSIF p_subject_type = 'product' THEN
    RETURN QUERY SELECT 'construction_recipe'::text, pv.recipe_version_id, 'recipe'::text, true FROM design_os.product_version pv WHERE pv.id = p_id AND pv.org_id = p_org;
  END IF;
END $function$;

DROP FUNCTION design_os.output_dependency_hashes(uuid, uuid, uuid);
DROP FUNCTION design_os.engineering_dependency_hashes(uuid, uuid);
DROP FUNCTION design_os.version_content_hash(text, uuid, uuid);
DROP FUNCTION design_os.commercial_input_hash(uuid, text, uuid, text);
DROP FUNCTION design_os.dependency_set_hash(jsonb);
DROP FUNCTION design_os.sha256_text(text);

CREATE OR REPLACE FUNCTION design_os.unaudited_tables()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$ SELECT ARRAY['audit_log', 'versioned_table', 'role', 'permission', 'default_role_permission', 'construction_variable', 'planning_variable', 'manufacturing_variable', 'error_code', 'output_purpose_rule', 'idempotency_record'] $function$;

DROP TABLE design_os.output_file_format;
DROP TABLE design_os.output_engine;

ALTER TABLE design_os.output_purpose_rule DISABLE TRIGGER forbid_mutation;
UPDATE design_os.output_purpose_rule SET design_statuses = '{IN_REVIEW,APPROVED,LOCKED}',
  description = 'Engineering / client review output; never FOR_PRODUCTION, never issued or released' WHERE purpose = 'FOR_REVIEW';
ALTER TABLE design_os.output_purpose_rule ENABLE TRIGGER forbid_mutation;
ALTER TABLE design_os.output_purpose_rule DROP CONSTRAINT output_purpose_rule_review_states;
ALTER TABLE design_os.output_purpose_rule ADD CONSTRAINT output_purpose_rule_review_states
  CHECK (purpose <> 'FOR_REVIEW' OR design_statuses <@ ARRAY['IN_REVIEW', 'APPROVED', 'LOCKED']::design_os.record_lifecycle_status[]);

ALTER TABLE design_os.error_code DISABLE TRIGGER forbid_mutation;
DELETE FROM design_os.error_code WHERE sqlstate IN ('LD025', 'LD026', 'LD906');
ALTER TABLE design_os.error_code ENABLE TRIGGER forbid_mutation;
