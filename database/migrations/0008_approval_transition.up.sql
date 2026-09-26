-- 0008 approval and transitions (M5 §4, D1, D2, D8): approval requests/decisions and the single write path
-- for lifecycle changes, design_os.transition(). It performs INTEGRITY checks and state changes only:
-- permissions, allowed transitions, approver ≠ submitter, reviewed content hash, dependency lifecycles,
-- presence of an engine validation run with zero BLOCKERs. It never calculates anything.
SET LOCAL ROLE design_os_owner;

CREATE TABLE design_os.approval_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  subject_type text NOT NULL REFERENCES design_os.versioned_table (subject_type),
  subject_id uuid NOT NULL,
  subject_content_hash text NOT NULL,
  requested_by uuid NOT NULL REFERENCES design_os.app_user (id),
  requested_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'APPROVED', 'CHANGES_REQUESTED')),
  closed_at timestamptz
);
CREATE UNIQUE INDEX approval_request_one_open ON design_os.approval_request (subject_type, subject_id) WHERE status = 'OPEN';

-- History of every lifecycle action (D2: request changes records who, when, why and the previous status).
CREATE TABLE design_os.approval_decision (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  subject_type text NOT NULL REFERENCES design_os.versioned_table (subject_type),
  subject_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('SUBMIT', 'REQUEST_CHANGES', 'APPROVE', 'LOCK', 'SUPERSEDE')),
  decided_by uuid NOT NULL REFERENCES design_os.app_user (id),
  decided_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  previous_status design_os.record_lifecycle_status NOT NULL,
  new_status design_os.record_lifecycle_status NOT NULL,
  subject_content_hash text NOT NULL,
  approval_request_id uuid REFERENCES design_os.approval_request (id)
);
SELECT design_os.install_insert_only('design_os.approval_decision');

-- Exact lifecycle of any registered version (tenant-scoped).
CREATE FUNCTION design_os.version_status(p_subject_type text, p_id uuid, p_org uuid) RETURNS design_os.record_lifecycle_status
  LANGUAGE plpgsql STABLE
  AS $$
DECLARE
  tbl regclass;
  st design_os.record_lifecycle_status;
BEGIN
  SELECT version_table INTO tbl FROM design_os.versioned_table WHERE subject_type = p_subject_type;
  EXECUTE format('SELECT status FROM %s WHERE id = $1 AND org_id = $2', tbl) INTO st USING p_id, p_org;
  RETURN st;
END $$;

-- The exact dependency VERSIONS of a version. For a design version: its 12 pins (required ones flagged);
-- for catalog versions: their member item versions; for a product version: its recipe version.
CREATE FUNCTION design_os.version_dependencies(p_subject_type text, p_id uuid, p_org uuid)
  RETURNS TABLE (dep_subject_type text, dep_version_id uuid, name text, required boolean)
  LANGUAGE plpgsql STABLE
  AS $$
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
END $$;

-- https URL on hettich.com or a subdomain (mirrors the Hettich engine's official-source rule; a state check, not a calculation).
CREATE FUNCTION design_os.is_official_hettich_url(p_url text) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT coalesce(p_url ~* '^https://([a-z0-9-]+\.)*hettich\.com(:[0-9]+)?([/?#]|$)', false) $$;

-- Why a version cannot be approved yet (empty = no integrity objection). Lookups only.
CREATE FUNCTION design_os.approval_problems(p_subject_type text, p_id uuid, p_org uuid) RETURNS text[]
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

-- Record one lifecycle decision (history for approval and audit).
CREATE FUNCTION design_os.record_decision(p_org uuid, p_subject_type text, p_id uuid, p_action text, p_actor uuid, p_reason text,
                                          p_prev design_os.record_lifecycle_status, p_new design_os.record_lifecycle_status, p_hash text, p_request uuid) RETURNS void
  LANGUAGE sql
  AS $$
    INSERT INTO design_os.approval_decision (org_id, subject_type, subject_id, action, decided_by, decided_at, reason, previous_status, new_status, subject_content_hash, approval_request_id)
    VALUES (p_org, p_subject_type, p_id, p_action, p_actor, now(), p_reason, p_prev, p_new, p_hash, p_request)
  $$;

-- Lock a version and, recursively, every exact dependency version it pins (D1). Only APPROVED versions change
-- (→ LOCKED); LOCKED stays LOCKED; SUPERSEDED stays SUPERSEDED (already immutable). Never touches newer or
-- unrelated versions; every lookup is scoped to the organization.
CREATE FUNCTION design_os.lock_cascade(p_subject_type text, p_id uuid, p_org uuid, p_actor uuid, p_reason text) RETURNS void
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

-- The single write path for lifecycle changes. Actions: SUBMIT, REQUEST_CHANGES, APPROVE, LOCK.
-- SUPERSEDE happens only inside APPROVE (the previous effective version of the same entity).
CREATE FUNCTION design_os.transition(p_subject_type text, p_id uuid, p_action text, p_reason text, p_expected_content_hash text DEFAULT NULL)
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
