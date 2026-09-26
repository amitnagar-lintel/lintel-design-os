-- 0017 output provenance (M5 Step 7, approved Step 6 plan revision 4, docs/architecture/M5-STEP6-OUTPUT-PLAN.md).
--  1. A design version is engineering-only: the PricingStandard, QuotationPolicy and ManufacturingStandard pins leave
--     design_version (commercial and manufacturing versions are chosen per output and recorded on the snapshot).
--  2. Validation runs carry a purpose: APPROVAL (SUBMIT / APPROVE evidence) or OUTPUT_GENERATION (evidence for one
--     output-generation context; any design status; never changes the design). Engine provenance: name, fingerprint
--     (dependency-closure hash) and closure beside version and build.
--  3. Dependency content hashes are computed here, in one place (design_os.version_content_hash): a pinned or chosen
--     version's own content columns, its DRAFT-guarded child rows and, recursively, its member / recipe dependencies.
--  4. Snapshots: exact engineering binding (input hash + revision), dependency hashes, commercial input hash, validation
--     run, per-engine provenance, upstream snapshot edges, natural identity, drawing scope and a sealed one-to-many
--     file manifest.
--  5. FOR_REVIEW may also be produced from SUPERSEDED designs (reproduction / review only); FOR_PRODUCTION, issue and
--     release stay impossible for them.
--  6. Issuing a quotation LOCKs the exact commercial versions it was priced with.
-- Integrity only: no business calculation. The engines stay the calculation authority.
SET LOCAL ROLE design_os_owner;

DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['bom_snapshot', 'boq_snapshot', 'pricing_snapshot', 'quotation_snapshot', 'drawing_snapshot', 'manufacturing_document_snapshot']::text[] || ARRAY['drawing_snapshot_file', 'quotation_issue', 'drawing_issue'] LOOP
    EXECUTE format('SELECT count(*) FROM design_os.%I', t) INTO n;
    IF n > 0 THEN RAISE EXCEPTION '0017: design_os.% is not empty; the output model can only be migrated before any output exists', t; END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------- error codes
INSERT INTO design_os.error_code (sqlstate, code, http_status, api_facing, description) VALUES
  ('LD025', 'SOURCE_SNAPSHOT_INCOMPATIBLE', 409, true, 'An upstream snapshot is for other inputs, another design version or other commercial versions'),
  ('LD026', 'SOURCE_PURPOSE_INSUFFICIENT', 409, true, 'An upstream snapshot has a weaker purpose than the output that uses it'),
  ('LD906', 'VALIDATION_RUN_UNREFERENCED', 500, false, 'Integrity guard: an OUTPUT_GENERATION validation run must be used by a snapshot of the same transaction');

-- ---------------------------------------------------------------- output purposes: FOR_REVIEW also from SUPERSEDED designs
ALTER TABLE design_os.output_purpose_rule DROP CONSTRAINT output_purpose_rule_review_states;
ALTER TABLE design_os.output_purpose_rule ADD CONSTRAINT output_purpose_rule_review_states
  CHECK (purpose <> 'FOR_REVIEW' OR design_statuses <@ ARRAY['IN_REVIEW', 'APPROVED', 'LOCKED', 'SUPERSEDED']::design_os.record_lifecycle_status[]);
ALTER TABLE design_os.output_purpose_rule DISABLE TRIGGER forbid_mutation;
UPDATE design_os.output_purpose_rule SET design_statuses = '{IN_REVIEW,APPROVED,LOCKED,SUPERSEDED}',
  description = 'Engineering / client review output (a SUPERSEDED design only for reproduction / review); never FOR_PRODUCTION, never issued or released'
  WHERE purpose = 'FOR_REVIEW';
ALTER TABLE design_os.output_purpose_rule ENABLE TRIGGER forbid_mutation;

-- ---------------------------------------------------------------- registries
CREATE TABLE design_os.output_engine (
  name text PRIMARY KEY CHECK (name ~ '^[a-z][a-z_]*$'),
  snapshot_kind design_os.snapshot_kind UNIQUE,
  description text NOT NULL
);
INSERT INTO design_os.output_engine (name, snapshot_kind, description) VALUES
  ('validation', NULL, 'Room / model validation (@lintel/design-engine resolveRoom)'),
  ('bom', 'BOM', '@lintel/bom-engine generateRoomBom'),
  ('boq', 'BOQ', '@lintel/boq-engine generateRoomBoq'),
  ('pricing', 'PRICING', '@lintel/pricing-engine priceRoom'),
  ('quotation', 'QUOTATION', '@lintel/pricing-engine quoteRoom'),
  ('drawing', 'DRAWING', '@lintel/drawing-engine (room and cabinet drawings, SVG / PDF)'),
  ('manufacturing', 'MANUFACTURING_DOCUMENT', 'Reserved: no manufacturing engine exists yet');
SELECT design_os.install_insert_only('design_os.output_engine');
ALTER TABLE design_os.output_engine ENABLE ROW LEVEL SECURITY;
CREATE POLICY registry_read ON design_os.output_engine FOR SELECT TO design_os_api USING (true);
REVOKE ALL ON design_os.output_engine FROM PUBLIC;
GRANT SELECT ON design_os.output_engine TO design_os_api;

CREATE TABLE design_os.output_file_format (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9]*$'),
  content_type text NOT NULL,
  extension text NOT NULL CHECK (extension ~ '^[a-z0-9]+$'),
  sort_order integer NOT NULL UNIQUE,
  sheet_scoped boolean NOT NULL,
  kinds design_os.snapshot_kind[] NOT NULL CHECK (cardinality(kinds) > 0)
);
INSERT INTO design_os.output_file_format (code, content_type, extension, sort_order, sheet_scoped, kinds) VALUES
  ('PDF', 'application/pdf', 'pdf', 10, false, '{DRAWING}'),
  ('SVG', 'image/svg+xml', 'svg', 20, true, '{DRAWING}');
SELECT design_os.install_insert_only('design_os.output_file_format');
ALTER TABLE design_os.output_file_format ENABLE ROW LEVEL SECURITY;
CREATE POLICY registry_read ON design_os.output_file_format FOR SELECT TO design_os_api USING (true);
REVOKE ALL ON design_os.output_file_format FROM PUBLIC;
GRANT SELECT ON design_os.output_file_format TO design_os_api;

CREATE OR REPLACE FUNCTION design_os.unaudited_tables()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$ SELECT ARRAY['audit_log', 'versioned_table', 'role', 'permission', 'default_role_permission', 'construction_variable', 'planning_variable', 'manufacturing_variable', 'error_code', 'output_purpose_rule', 'idempotency_record', 'output_engine', 'output_file_format'] $function$;

-- ---------------------------------------------------------------- hashing (the one canonical definition; @lintel/persistence mirrors the text forms)
CREATE FUNCTION design_os.sha256_text(p text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT
  AS $f$ SELECT 'sha256:' || encode(sha256(convert_to(p, 'UTF8')), 'hex') $f$;

-- key=value lines, sorted by key (code point), joined by LF.
CREATE FUNCTION design_os.dependency_set_hash(p jsonb) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT
  AS $f$ SELECT design_os.sha256_text(coalesce(string_agg(e.key || '=' || e.value, E'\n' ORDER BY e.key COLLATE "C"), '')) FROM jsonb_each_text(p) AS e $f$;

-- One line per chosen commercial version, "<pin>=<version id>:<dependency hash>", sorted by pin, joined by LF.
CREATE FUNCTION design_os.commercial_input_hash(p_pricing uuid, p_pricing_hash text, p_policy uuid, p_policy_hash text) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $f$ SELECT CASE WHEN p_pricing IS NULL THEN NULL ELSE design_os.sha256_text(
            'pricing_standard_version_id=' || p_pricing || ':' || p_pricing_hash
            || CASE WHEN p_policy IS NULL THEN '' ELSE E'\nquotation_policy_version_id=' || p_policy || ':' || p_policy_hash END) END $f$;

-- The content of one exact version: its content columns (lifecycle columns excluded; they are not content), every
-- DRAFT-guarded child table's rows, and recursively its member / recipe dependencies. NULL when not found in p_org.
-- Timestamps are rendered in UTC regardless of the caller's session.
CREATE FUNCTION design_os.version_content_hash(p_subject_type text, p_id uuid, p_org uuid) RETURNS text
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp SET timezone = 'UTC'
  AS $f$
DECLARE
  tbl regclass;
  body text;
  child record;
  agg text;
  dep record;
BEGIN
  IF p_subject_type = 'design' THEN RETURN NULL; END IF;
  SELECT version_table INTO tbl FROM design_os.versioned_table WHERE subject_type = p_subject_type;
  IF tbl IS NULL THEN RETURN NULL; END IF;
  EXECUTE format('SELECT (to_jsonb(v) - $1 - ''row_version'')::text FROM %s v WHERE v.id = $2 AND v.org_id = $3', tbl)
    INTO body USING design_os.lifecycle_columns(), p_id, p_org;
  IF body IS NULL THEN RETURN NULL; END IF;
  body := p_subject_type || ':' || p_id || E'\n' || body;
  FOR child IN
    SELECT c.oid::regclass AS child_table, split_part(encode(t.tgargs, 'escape'), '\000', 2) AS col
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = 'guard_draft_content' AND split_part(encode(t.tgargs, 'escape'), '\000', 1)::regclass = tbl
    ORDER BY c.relname COLLATE "C"
  LOOP
    EXECUTE format('SELECT string_agg(r.j, E''\n'' ORDER BY r.j COLLATE "C") FROM (SELECT (to_jsonb(x) - ''org_id'')::text AS j FROM %s x WHERE x.%I = $1 AND x.org_id = $2) r',
                   child.child_table, child.col) INTO agg USING p_id, p_org;
    body := body || E'\n#' || child.child_table::text || E'\n' || coalesce(agg, '');
  END LOOP;
  FOR dep IN SELECT d.dep_subject_type, d.dep_version_id FROM design_os.version_dependencies(p_subject_type, p_id, p_org) d
             WHERE d.dep_version_id IS NOT NULL ORDER BY d.dep_subject_type COLLATE "C", d.dep_version_id LOOP
    body := body || E'\n>' || dep.dep_subject_type || ':' || dep.dep_version_id || '='
            || coalesce(design_os.version_content_hash(dep.dep_subject_type, dep.dep_version_id, p_org), 'MISSING');
  END LOOP;
  RETURN design_os.sha256_text(body);
END $f$;

-- The engineering dependency hashes of a design version: { "<pin column>": "<version_content_hash>" } for every non-null pin.
CREATE FUNCTION design_os.engineering_dependency_hashes(p_org uuid, p_design_version uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $f$
DECLARE
  dv design_os.design_version%ROWTYPE;
  result jsonb := '{}';
  d record;
BEGIN
  SELECT * INTO dv FROM design_os.design_version WHERE id = p_design_version AND org_id = p_org;
  IF NOT FOUND THEN RETURN NULL; END IF;
  FOR d IN SELECT * FROM (VALUES
      ('construction_standard_version_id', 'construction_standard', dv.construction_standard_version_id),
      ('planning_standard_version_id', 'planning_standard', dv.planning_standard_version_id),
      ('edge_band_standard_version_id', 'edge_band_standard', dv.edge_band_standard_version_id),
      ('material_catalog_version_id', 'material_catalog', dv.material_catalog_version_id),
      ('finish_catalog_version_id', 'finish_catalog', dv.finish_catalog_version_id),
      ('hardware_catalog_version_id', 'hardware_catalog', dv.hardware_catalog_version_id),
      ('appliance_catalog_version_id', 'appliance_catalog', dv.appliance_catalog_version_id),
      ('product_catalog_version_id', 'product_catalog', dv.product_catalog_version_id),
      ('hettich_dataset_version_id', 'hettich_dataset', dv.hettich_dataset_version_id)) AS v(pin, subject, id) WHERE v.id IS NOT NULL LOOP
    result := result || jsonb_build_object(d.pin, coalesce(design_os.version_content_hash(d.subject, d.id, p_org), 'MISSING'));
  END LOOP;
  RETURN result;
END $f$;

-- API read path (the same function the triggers use): engineering + chosen commercial dependency hashes for one design
-- version the caller can access. A chosen commercial version outside the organization is simply absent from the result.
CREATE FUNCTION design_os.output_dependency_hashes(p_design_version uuid, p_pricing_standard uuid, p_quotation_policy uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $f$
DECLARE
  org uuid := design_os.current_org_id();
  dv design_os.design_version%ROWTYPE;
  result jsonb;
  h text;
BEGIN
  IF design_os.current_user_id() IS NULL OR org IS NULL OR NOT design_os.is_internal() THEN
    RAISE EXCEPTION 'output_dependency_hashes: an authenticated internal member of the organization is required' USING ERRCODE = 'LD002';
  END IF;
  SELECT * INTO dv FROM design_os.design_version WHERE id = p_design_version AND org_id = org;
  IF NOT FOUND OR NOT design_os.can_access_project(dv.project_id) THEN
    RAISE EXCEPTION 'output_dependency_hashes: design version % not found', p_design_version USING ERRCODE = 'LD005';
  END IF;
  result := design_os.engineering_dependency_hashes(org, dv.id);
  IF p_pricing_standard IS NOT NULL THEN
    h := design_os.version_content_hash('pricing_standard', p_pricing_standard, org);
    IF h IS NOT NULL THEN result := result || jsonb_build_object('pricing_standard_version_id', h); END IF;
  END IF;
  IF p_quotation_policy IS NOT NULL THEN
    h := design_os.version_content_hash('quotation_policy', p_quotation_policy, org);
    IF h IS NOT NULL THEN result := result || jsonb_build_object('quotation_policy_version_id', h); END IF;
  END IF;
  RETURN result;
END $f$;

-- ---------------------------------------------------------------- design versions: engineering inputs only
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

CREATE OR REPLACE FUNCTION design_os.maintain_input_revision()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.input_revision := 1;
  ELSIF (NEW.room_revision_id, NEW.construction_standard_version_id, NEW.planning_standard_version_id, NEW.edge_band_standard_version_id,
         NEW.material_catalog_version_id, NEW.finish_catalog_version_id, NEW.hardware_catalog_version_id, NEW.appliance_catalog_version_id, NEW.product_catalog_version_id,
         NEW.hettich_dataset_version_id, NEW.input_hash)
     IS DISTINCT FROM
        (OLD.room_revision_id, OLD.construction_standard_version_id, OLD.planning_standard_version_id, OLD.edge_band_standard_version_id,
         OLD.material_catalog_version_id, OLD.finish_catalog_version_id, OLD.hardware_catalog_version_id, OLD.appliance_catalog_version_id, OLD.product_catalog_version_id,
         OLD.hettich_dataset_version_id, OLD.input_hash) THEN
    NEW.input_revision := OLD.input_revision + 1;
  END IF;
  RETURN NEW;
END $function$;

ALTER TABLE design_os.design_version DROP CONSTRAINT design_version_manufacturing_fk, DROP CONSTRAINT design_version_pricing_fk,
  DROP CONSTRAINT design_version_quotation_policy_fk;
ALTER TABLE design_os.design_version DROP COLUMN manufacturing_standard_version_id, DROP COLUMN pricing_standard_version_id,
  DROP COLUMN quotation_policy_version_id;

-- ---------------------------------------------------------------- validation runs: purpose and engine provenance
ALTER TABLE design_os.validation_run RENAME COLUMN engine_hash TO engine_fingerprint;
ALTER TABLE design_os.validation_run RENAME CONSTRAINT validation_run_engine_hash_check TO validation_run_engine_fingerprint_check;
ALTER TABLE design_os.validation_run
  ADD COLUMN purpose text NOT NULL DEFAULT 'APPROVAL' CHECK (purpose IN ('APPROVAL', 'OUTPUT_GENERATION')),
  ADD COLUMN engine_name text NOT NULL DEFAULT 'validation' REFERENCES design_os.output_engine (name) CHECK (engine_name = 'validation'),
  ADD COLUMN engine_closure jsonb,
  ADD COLUMN dependency_set_hash text,
  ADD CONSTRAINT validation_run_org_id_unique UNIQUE (org_id, id);
ALTER TABLE design_os.validation_run ALTER COLUMN purpose DROP DEFAULT, ALTER COLUMN engine_name DROP DEFAULT;
-- Required for every run recorded from 0017 on; runs recorded before stay as they were (nothing is back-filled).
ALTER TABLE design_os.validation_run ADD CONSTRAINT validation_run_provenance_required CHECK (
  engine_fingerprint IS NOT NULL AND engine_fingerprint ~ '^sha256:[0-9a-f]{64}$' AND engine_closure IS NOT NULL AND jsonb_typeof(engine_closure) = 'object'
  AND dependency_set_hash IS NOT NULL AND dependency_set_hash ~ '^sha256:[0-9a-f]{64}$') NOT VALID;
COMMENT ON COLUMN design_os.validation_run.purpose IS 'APPROVAL: SUBMIT / APPROVE evidence (DRAFT / IN_REVIEW only). OUTPUT_GENERATION: evidence for one output-generation context (any design status; never changes the design).';
COMMENT ON COLUMN design_os.validation_run.engine_fingerprint IS 'Dependency-closure fingerprint of the validation engine (semantic version, reached source files, locked externals, runtime).';
COMMENT ON COLUMN design_os.validation_run.dependency_set_hash IS 'design_os.dependency_set_hash of the engineering dependency hashes at record time.';
-- Natural identity of OUTPUT_GENERATION evidence: the same exact inputs and engine give the same run (reused, never duplicated).
CREATE UNIQUE INDEX validation_run_output_identity ON design_os.validation_run (org_id, design_version_id, input_hash, input_revision, dependency_set_hash, engine_fingerprint)
  WHERE purpose = 'OUTPUT_GENERATION';

DROP FUNCTION design_os.record_validation_run(uuid, text, text, text, text, integer, integer, jsonb, text);

-- The only write path for validation runs (both purposes).
CREATE FUNCTION design_os.record_validation_run(p_purpose text, p_design_version_id uuid, p_input_hash text, p_engine_name text, p_engine_version text,
    p_engine_build text, p_engine_fingerprint text, p_engine_closure jsonb, p_blocker_count integer, p_warning_count integer, p_messages jsonb, p_content_hash text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $f$
DECLARE
  actor uuid := design_os.current_user_id();
  org uuid := design_os.current_org_id();
  dv design_os.design_version%ROWTYPE;
  dep_set text;
  existing design_os.validation_run%ROWTYPE;
  run_id uuid;
BEGIN
  IF actor IS NULL OR org IS NULL THEN
    RAISE EXCEPTION 'record_validation_run: an authenticated internal member of the organization is required' USING ERRCODE = 'LD002';
  END IF;
  IF NOT design_os.is_internal() THEN
    RAISE EXCEPTION 'record_validation_run: an authenticated internal member of the organization is required' USING ERRCODE = 'LD003';
  END IF;
  IF p_purpose = 'APPROVAL' THEN
    IF NOT (design_os.has_permission('output.generate.engineering') OR design_os.has_permission('design_version.author')) THEN
      RAISE EXCEPTION 'record_validation_run: missing permission to record engine validation runs' USING ERRCODE = 'LD001';
    END IF;
  ELSIF p_purpose = 'OUTPUT_GENERATION' THEN
    IF NOT (design_os.has_permission('output.generate.engineering') OR design_os.has_permission('output.generate.commercial')) THEN
      RAISE EXCEPTION 'record_validation_run: missing permission to generate outputs' USING ERRCODE = 'LD001';
    END IF;
  ELSE
    RAISE EXCEPTION 'record_validation_run: unknown purpose %', p_purpose USING ERRCODE = 'LD020';
  END IF;
  SELECT * INTO dv FROM design_os.design_version WHERE id = p_design_version_id AND org_id = org FOR SHARE;
  IF NOT FOUND OR NOT design_os.can_access_project(dv.project_id) THEN
    RAISE EXCEPTION 'record_validation_run: design version % not found', p_design_version_id USING ERRCODE = 'LD005';
  END IF;
  -- APPROVAL evidence exists only while the version can still be submitted or approved. OUTPUT_GENERATION evidence may
  -- be recorded in any status; it never changes the design version (this function writes only validation_run).
  IF p_purpose = 'APPROVAL' AND dv.status NOT IN ('DRAFT', 'IN_REVIEW') THEN
    RAISE EXCEPTION 'record_validation_run: design version is %; runs are recorded only for DRAFT or IN_REVIEW versions', dv.status USING ERRCODE = 'LD012', DETAIL = jsonb_build_object('status', dv.status)::text;
  END IF;
  IF p_input_hash IS DISTINCT FROM dv.input_hash THEN
    RAISE EXCEPTION 'record_validation_run: the run is for different inputs than the design version''s current input_hash' USING ERRCODE = 'LD012';
  END IF;
  dep_set := design_os.dependency_set_hash(design_os.engineering_dependency_hashes(org, dv.id));
  IF p_purpose = 'OUTPUT_GENERATION' THEN
    SELECT * INTO existing FROM design_os.validation_run
      WHERE purpose = 'OUTPUT_GENERATION' AND org_id = org AND design_version_id = dv.id AND input_hash = dv.input_hash
        AND input_revision = dv.input_revision AND dependency_set_hash = dep_set AND engine_fingerprint = p_engine_fingerprint;
    IF FOUND THEN
      -- Same exact inputs and engine: the result must be identical (the engines are deterministic).
      IF existing.content_hash <> p_content_hash OR existing.blocker_count <> p_blocker_count OR existing.warning_count <> p_warning_count THEN
        RAISE EXCEPTION 'record_validation_run: a different result exists for the same inputs and engine' USING ERRCODE = 'LD016';
      END IF;
      RETURN existing.id;
    END IF;
  END IF;
  INSERT INTO design_os.validation_run (org_id, design_version_id, purpose, input_hash, input_revision, dependency_set_hash, engine_name, engine_version,
                                        engine_build, engine_fingerprint, engine_closure, content_hash, blocker_count, warning_count, messages, created_by, created_at)
  VALUES (org, dv.id, p_purpose, dv.input_hash, dv.input_revision, dep_set, p_engine_name, p_engine_version, p_engine_build, p_engine_fingerprint,
          p_engine_closure, p_content_hash, p_blocker_count, p_warning_count, p_messages, actor, now())
  RETURNING id INTO run_id;
  RETURN run_id;
END $f$;
REVOKE ALL ON FUNCTION design_os.record_validation_run(text, uuid, text, text, text, text, text, jsonb, integer, integer, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION design_os.record_validation_run(text, uuid, text, text, text, text, text, jsonb, integer, integer, jsonb, text) TO design_os_api;
REVOKE ALL ON FUNCTION design_os.output_dependency_hashes(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION design_os.output_dependency_hashes(uuid, uuid, uuid) TO design_os_api;
REVOKE ALL ON FUNCTION design_os.version_content_hash(text, uuid, uuid), design_os.engineering_dependency_hashes(uuid, uuid) FROM PUBLIC;

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
        SELECT 1 FROM design_os.validation_run v WHERE v.design_version_id = p_id AND v.org_id = org AND v.purpose = 'APPROVAL'
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
    -- Only the latest immutable APPROVAL engine run for exactly the current inputs (input_hash AND database input_revision) counts.
    SELECT * INTO dv FROM design_os.design_version WHERE id = p_id AND org_id = p_org;
    SELECT * INTO run FROM design_os.validation_run
      WHERE design_version_id = p_id AND org_id = p_org AND purpose = 'APPROVAL' AND input_hash = dv.input_hash AND input_revision = dv.input_revision
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

-- ---------------------------------------------------------------- snapshots: exact provenance
DO $$
DECLARE
  t text;
  engines jsonb := '{"bom_snapshot": "bom", "boq_snapshot": "boq", "pricing_snapshot": "pricing", "quotation_snapshot": "quotation", "drawing_snapshot": "drawing", "manufacturing_document_snapshot": "manufacturing"}';
BEGIN
  FOREACH t IN ARRAY ARRAY['bom_snapshot', 'boq_snapshot', 'pricing_snapshot', 'quotation_snapshot', 'drawing_snapshot', 'manufacturing_document_snapshot']::text[] LOOP
    EXECUTE format('ALTER TABLE design_os.%1$I RENAME COLUMN engine_hash TO engine_seal', t);
    EXECUTE format($s$ALTER TABLE design_os.%1$I
      ADD COLUMN input_revision integer NOT NULL CHECK (input_revision >= 1),
      ADD COLUMN dependency_hashes jsonb NOT NULL CHECK (jsonb_typeof(dependency_hashes) = 'object'),
      ADD COLUMN dependency_set_hash text NOT NULL CHECK (dependency_set_hash ~ '^sha256:[0-9a-f]{64}$'),
      ADD COLUMN commercial_input_hash text CHECK (commercial_input_hash ~ '^sha256:[0-9a-f]{64}$'),
      ADD COLUMN validation_run_id uuid NOT NULL,
      ADD COLUMN engine_name text NOT NULL REFERENCES design_os.output_engine (name) CHECK (engine_name = %2$L),
      ADD COLUMN engine_build text NOT NULL CHECK (engine_build ~ '^[0-9A-Za-z][0-9A-Za-z._+-]{6,127}$'),
      ADD COLUMN engine_fingerprint text NOT NULL CHECK (engine_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
      ADD COLUMN engine_closure jsonb NOT NULL CHECK (jsonb_typeof(engine_closure) = 'object'),
      ADD COLUMN warning_count integer NOT NULL CHECK (warning_count >= 0),
      ADD COLUMN output_complete boolean NOT NULL,
      ADD CONSTRAINT %1$s_commercial_input CHECK ((kind IN ('PRICING', 'QUOTATION')) = (commercial_input_hash IS NOT NULL)),
      ADD CONSTRAINT %1$s_validation_run_fk FOREIGN KEY (org_id, validation_run_id) REFERENCES design_os.validation_run (org_id, id)$s$, t, engines ->> t);
  END LOOP;
END $$;

ALTER TABLE design_os.boq_snapshot ADD COLUMN bom_snapshot_id uuid NOT NULL,
  ADD CONSTRAINT boq_snapshot_bom_source_fk FOREIGN KEY (org_id, bom_snapshot_id) REFERENCES design_os.bom_snapshot (org_id, id);
ALTER TABLE design_os.pricing_snapshot ADD COLUMN bom_snapshot_id uuid NOT NULL, ADD COLUMN boq_snapshot_id uuid NOT NULL,
  ADD CONSTRAINT pricing_snapshot_bom_source_fk FOREIGN KEY (org_id, bom_snapshot_id) REFERENCES design_os.bom_snapshot (org_id, id),
  ADD CONSTRAINT pricing_snapshot_boq_source_fk FOREIGN KEY (org_id, boq_snapshot_id) REFERENCES design_os.boq_snapshot (org_id, id);
ALTER TABLE design_os.quotation_snapshot ADD COLUMN boq_snapshot_id uuid NOT NULL, ADD COLUMN pricing_snapshot_id uuid NOT NULL,
  ADD CONSTRAINT quotation_snapshot_boq_source_fk FOREIGN KEY (org_id, boq_snapshot_id) REFERENCES design_os.boq_snapshot (org_id, id),
  ADD CONSTRAINT quotation_snapshot_pricing_source_fk FOREIGN KEY (org_id, pricing_snapshot_id) REFERENCES design_os.pricing_snapshot (org_id, id),
  ADD CONSTRAINT quotation_snapshot_revision_unique UNIQUE (design_version_id, revision_number);

ALTER TABLE design_os.drawing_snapshot ALTER COLUMN drawing_type DROP DEFAULT,
  ADD CONSTRAINT drawing_snapshot_type_check CHECK (drawing_type IN ('WALL_INTERNAL_ELEVATION', 'ROOM_PANEL_SCHEDULE', 'FRONT_ELEVATION', 'SIDE_SECTION',
                                                                     'CABINET_INTERNAL_ELEVATION', 'PANEL_SCHEDULE')),
  ADD COLUMN drawing_scope text NOT NULL CHECK (drawing_scope IN ('ROOM', 'OBJECT')),
  ADD COLUMN wall_id text CHECK (wall_id IN ('A', 'B', 'C', 'D')),
  ADD COLUMN object_lineage_id text CHECK (btrim(object_lineage_id) <> ''),
  ADD COLUMN cut_x_mm numeric,
  ADD COLUMN drawing_number text NOT NULL CHECK (drawing_number ~ '^[A-Z0-9][A-Z0-9-]{0,39}$'),
  ADD COLUMN drawing_revision text NOT NULL CHECK (drawing_revision ~ '^[A-Z0-9]{1,4}$'),
  ADD COLUMN file_manifest_hash text NOT NULL CHECK (file_manifest_hash ~ '^sha256:[0-9a-f]{64}$'),
  ADD CONSTRAINT drawing_snapshot_scope CHECK ((drawing_type IN ('WALL_INTERNAL_ELEVATION', 'ROOM_PANEL_SCHEDULE')) = (drawing_scope = 'ROOM')),
  ADD CONSTRAINT drawing_snapshot_wall CHECK ((drawing_type = 'WALL_INTERNAL_ELEVATION') = (wall_id IS NOT NULL)),
  ADD CONSTRAINT drawing_snapshot_object CHECK ((drawing_scope = 'OBJECT') = (object_lineage_id IS NOT NULL)),
  ADD CONSTRAINT drawing_snapshot_cut CHECK (cut_x_mm IS NULL OR drawing_type = 'SIDE_SECTION');

-- Natural identity: the same exact inputs, dependency content, engine, purpose, sources and parameters are one output.
CREATE UNIQUE INDEX bom_snapshot_identity ON design_os.bom_snapshot (org_id, design_version_id, purpose, input_hash, input_revision, dependency_set_hash, engine_fingerprint);
CREATE UNIQUE INDEX boq_snapshot_identity ON design_os.boq_snapshot (org_id, design_version_id, purpose, input_hash, input_revision, dependency_set_hash, engine_fingerprint, bom_snapshot_id);
CREATE UNIQUE INDEX pricing_snapshot_identity ON design_os.pricing_snapshot (org_id, design_version_id, purpose, input_hash, input_revision, dependency_set_hash, engine_fingerprint,
  commercial_input_hash, bom_snapshot_id, boq_snapshot_id);
CREATE UNIQUE INDEX quotation_snapshot_identity ON design_os.quotation_snapshot (org_id, design_version_id, purpose, input_hash, input_revision, dependency_set_hash, engine_fingerprint,
  commercial_input_hash, boq_snapshot_id, pricing_snapshot_id);
CREATE UNIQUE INDEX drawing_snapshot_identity ON design_os.drawing_snapshot (org_id, design_version_id, purpose, input_hash, input_revision, dependency_set_hash, engine_fingerprint,
  drawing_type, drawing_scope, wall_id, object_lineage_id, cut_x_mm, drawing_number, drawing_revision) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX manufacturing_document_snapshot_identity ON design_os.manufacturing_document_snapshot (org_id, design_version_id, purpose, input_hash, input_revision,
  dependency_set_hash, engine_fingerprint, manufacturing_standard_version_id);

-- Provenance: every column checked against the design version, the dependency content recomputed here, the
-- validation evidence checked, then the purpose rules (FOR_PRODUCTION guard last).
CREATE OR REPLACE FUNCTION design_os.check_snapshot_provenance() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $f$
DECLARE
  dv design_os.design_version%ROWTYPE;
  run design_os.validation_run%ROWTYPE;
  problems text[] := ARRAY[]::text[];
  production_problems integer := 0;
  purpose_problems integer := 0;
  rule design_os.output_purpose_rule%ROWTYPE;
  code text;
  engineering jsonb;
  expected jsonb;
  pricing_hash text;
  policy_hash text;
  st design_os.record_lifecycle_status;
  guard_failed boolean := false;
BEGIN
  SELECT * INTO dv FROM design_os.design_version WHERE id = NEW.design_version_id AND org_id = NEW.org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'design_os.%: design version % not found in this organization', TG_TABLE_NAME, NEW.design_version_id USING ERRCODE = 'LD005';
  END IF;
  IF NEW.design_version_status <> dv.status THEN problems := problems || format('design_version_status %s ≠ %s', NEW.design_version_status, dv.status); END IF;
  IF NEW.design_version_content_hash <> dv.content_hash THEN problems := problems || 'design_version_content_hash differs from the design version'::text; END IF;
  IF NEW.input_hash <> dv.input_hash OR NEW.input_revision <> dv.input_revision THEN problems := problems || 'input_hash / input_revision differ from the design version'::text; END IF;
  IF NEW.construction_standard_version_id <> dv.construction_standard_version_id THEN problems := problems || 'construction_standard_version_id ≠ pin'::text; END IF;
  IF NEW.planning_standard_version_id <> dv.planning_standard_version_id THEN problems := problems || 'planning_standard_version_id ≠ pin'::text; END IF;
  IF NEW.edge_band_standard_version_id <> dv.edge_band_standard_version_id THEN problems := problems || 'edge_band_standard_version_id ≠ pin'::text; END IF;
  IF NEW.material_catalog_version_id <> dv.material_catalog_version_id THEN problems := problems || 'material_catalog_version_id ≠ pin'::text; END IF;
  IF NEW.finish_catalog_version_id <> dv.finish_catalog_version_id THEN problems := problems || 'finish_catalog_version_id ≠ pin'::text; END IF;
  IF NEW.hardware_catalog_version_id <> dv.hardware_catalog_version_id THEN problems := problems || 'hardware_catalog_version_id ≠ pin'::text; END IF;
  IF NEW.product_catalog_version_id <> dv.product_catalog_version_id THEN problems := problems || 'product_catalog_version_id ≠ pin'::text; END IF;
  IF NEW.hettich_dataset_version_id <> dv.hettich_dataset_version_id THEN problems := problems || 'hettich_dataset_version_id ≠ pin'::text; END IF;
  IF NEW.appliance_catalog_version_id IS DISTINCT FROM dv.appliance_catalog_version_id THEN problems := problems || 'appliance_catalog_version_id ≠ pin'::text; END IF;
  -- Commercial and manufacturing versions are chosen per output (not design pins): present exactly where the kind uses them.
  IF (NEW.kind IN ('PRICING', 'QUOTATION')) <> (NEW.pricing_standard_version_id IS NOT NULL) THEN problems := problems || 'pricing_standard_version_id applies exactly to PRICING and QUOTATION'::text; END IF;
  IF (NEW.kind = 'QUOTATION') <> (NEW.quotation_policy_version_id IS NOT NULL) THEN problems := problems || 'quotation_policy_version_id applies exactly to QUOTATION'::text; END IF;
  IF (NEW.kind = 'MANUFACTURING_DOCUMENT') <> (NEW.manufacturing_standard_version_id IS NOT NULL) THEN problems := problems || 'manufacturing_standard_version_id applies exactly to MANUFACTURING_DOCUMENT'::text; END IF;
  -- Dependency content, recomputed here (never trusted from the caller).
  engineering := design_os.engineering_dependency_hashes(NEW.org_id, dv.id);
  expected := engineering;
  IF NEW.pricing_standard_version_id IS NOT NULL THEN
    pricing_hash := design_os.version_content_hash('pricing_standard', NEW.pricing_standard_version_id, NEW.org_id);
    expected := expected || jsonb_build_object('pricing_standard_version_id', coalesce(pricing_hash, 'MISSING'));
  END IF;
  IF NEW.quotation_policy_version_id IS NOT NULL THEN
    policy_hash := design_os.version_content_hash('quotation_policy', NEW.quotation_policy_version_id, NEW.org_id);
    expected := expected || jsonb_build_object('quotation_policy_version_id', coalesce(policy_hash, 'MISSING'));
  END IF;
  IF NEW.manufacturing_standard_version_id IS NOT NULL THEN
    expected := expected || jsonb_build_object('manufacturing_standard_version_id',
      coalesce(design_os.version_content_hash('manufacturing_standard', NEW.manufacturing_standard_version_id, NEW.org_id), 'MISSING'));
  END IF;
  IF NEW.dependency_hashes IS DISTINCT FROM expected THEN problems := problems || 'dependency_hashes differ from the current content of the exact versions'::text; END IF;
  IF NEW.dependency_set_hash IS DISTINCT FROM design_os.dependency_set_hash(NEW.dependency_hashes) THEN problems := problems || 'dependency_set_hash does not match dependency_hashes'::text; END IF;
  IF NEW.commercial_input_hash IS DISTINCT FROM design_os.commercial_input_hash(NEW.pricing_standard_version_id, pricing_hash, NEW.quotation_policy_version_id, policy_hash) THEN
    problems := problems || 'commercial_input_hash does not match the chosen commercial versions'::text;
  END IF;
  -- Validation evidence: an OUTPUT_GENERATION run of exactly these engineering inputs.
  SELECT * INTO run FROM design_os.validation_run WHERE id = NEW.validation_run_id AND org_id = NEW.org_id;
  IF NOT FOUND OR run.purpose <> 'OUTPUT_GENERATION' OR run.design_version_id <> dv.id OR run.input_hash <> NEW.input_hash
     OR run.input_revision <> NEW.input_revision OR run.dependency_set_hash IS DISTINCT FROM design_os.dependency_set_hash(engineering) THEN
    problems := problems || 'validation_run_id must be an OUTPUT_GENERATION run of exactly these engineering inputs'::text;
  END IF;
  -- Cabinet drawings: the object (engine lineage id) belongs to this design version. Read through to_jsonb(NEW): the
  -- column exists only on drawing_snapshot.
  IF to_jsonb(NEW) ->> 'object_lineage_id' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM design_os.design_object o WHERE o.design_version_id = dv.id AND o.org_id = dv.org_id AND o.lineage_id = to_jsonb(NEW) ->> 'object_lineage_id') THEN
    problems := problems || format('object %s is not part of the design version', to_jsonb(NEW) ->> 'object_lineage_id');
  END IF;
  IF NEW.purpose = 'FOR_PRODUCTION' AND (dv.status NOT IN ('APPROVED', 'LOCKED') OR NEW.blocker_count > 0 OR coalesce(run.blocker_count, 0) > 0 OR NOT NEW.output_complete) THEN
    production_problems := production_problems + 1;
    guard_failed := guard_failed OR dv.status NOT IN ('APPROVED', 'LOCKED') OR NOT NEW.output_complete;
    problems := problems || format('FOR_PRODUCTION requires an APPROVED or LOCKED design version, 0 BLOCKERs in the output and its validation, and a complete output (design version is %s, %s / %s BLOCKER(s))',
                                   dv.status, NEW.blocker_count, coalesce(run.blocker_count, 0));
  END IF;
  IF NEW.purpose = 'FOR_PRODUCTION' THEN
    FOR st IN SELECT design_os.version_status(s.subject, s.id, NEW.org_id) FROM (VALUES ('pricing_standard', NEW.pricing_standard_version_id),
        ('quotation_policy', NEW.quotation_policy_version_id), ('manufacturing_standard', NEW.manufacturing_standard_version_id)) AS s(subject, id) WHERE s.id IS NOT NULL LOOP
      IF st IS NULL OR st NOT IN ('APPROVED', 'LOCKED') THEN
        production_problems := production_problems + 1;
        guard_failed := true;
        problems := problems || format('FOR_PRODUCTION requires APPROVED or LOCKED commercial / manufacturing versions (one is %s)', coalesce(st::text, 'missing'));
      END IF;
    END LOOP;
  END IF;
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
    code := CASE WHEN cardinality(problems) > production_problems + purpose_problems THEN 'LD016'
                 WHEN purpose_problems > 0 THEN 'LD024'
                 WHEN guard_failed OR dv.status NOT IN ('APPROVED', 'LOCKED') THEN 'LD021'
                 ELSE 'LD011' END;
    RAISE EXCEPTION 'design_os.%: snapshot provenance rejected: %', TG_TABLE_NAME, array_to_string(problems, '; ')
      USING ERRCODE = code, DETAIL = jsonb_build_object('problems', to_jsonb(problems), 'purpose', NEW.purpose, 'blockerCount', NEW.blocker_count)::text;
  END IF;
  RETURN NEW;
END $f$;

-- Upstream edges: same design version and engineering inputs, same engineering dependency content, a purpose at least
-- as strong, and (Quotation ← Pricing) the same PricingStandard content.
CREATE FUNCTION design_os.check_snapshot_sources() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $f$
DECLARE
  i integer := 0;
  col text;
  tbl text;
  src_id uuid;
  src record;
  rank_of jsonb := '{"PRELIMINARY": 0, "FOR_REVIEW": 1, "FOR_PRODUCTION": 2}';
  commercial text[] := ARRAY['pricing_standard_version_id', 'quotation_policy_version_id', 'manufacturing_standard_version_id'];
BEGIN
  WHILE i < TG_NARGS LOOP
    col := TG_ARGV[i];
    tbl := TG_ARGV[i + 1];
    i := i + 2;
    src_id := (to_jsonb(NEW) ->> col)::uuid;
    EXECUTE format('SELECT design_version_id, input_hash, input_revision, dependency_hashes, purpose, pricing_standard_version_id FROM design_os.%I WHERE id = $1 AND org_id = $2', tbl)
      INTO src USING src_id, NEW.org_id;
    IF src.design_version_id IS NULL THEN
      RAISE EXCEPTION 'design_os.%: % % not found in this organization', TG_TABLE_NAME, col, src_id USING ERRCODE = 'LD005';
    END IF;
    IF src.design_version_id <> NEW.design_version_id OR src.input_hash <> NEW.input_hash OR src.input_revision <> NEW.input_revision
       OR (src.dependency_hashes - commercial) IS DISTINCT FROM (NEW.dependency_hashes - commercial)
       OR (tbl = 'pricing_snapshot' AND (src.pricing_standard_version_id IS DISTINCT FROM NEW.pricing_standard_version_id
            OR src.dependency_hashes -> 'pricing_standard_version_id' IS DISTINCT FROM NEW.dependency_hashes -> 'pricing_standard_version_id')) THEN
      RAISE EXCEPTION 'design_os.%: % is for other inputs or versions than this output', TG_TABLE_NAME, col
        USING ERRCODE = 'LD025', DETAIL = jsonb_build_object('source', col)::text;
    END IF;
    IF (rank_of ->> src.purpose)::int < (rank_of ->> NEW.purpose)::int THEN
      RAISE EXCEPTION 'design_os.%: % is %, weaker than %', TG_TABLE_NAME, col, src.purpose, NEW.purpose
        USING ERRCODE = 'LD026', DETAIL = jsonb_build_object('source', col, 'sourcePurpose', src.purpose, 'purpose', NEW.purpose)::text;
    END IF;
  END LOOP;
  RETURN NEW;
END $f$;
CREATE TRIGGER check_snapshot_sources BEFORE INSERT ON design_os.boq_snapshot FOR EACH ROW EXECUTE FUNCTION design_os.check_snapshot_sources('bom_snapshot_id', 'bom_snapshot');
CREATE TRIGGER check_snapshot_sources BEFORE INSERT ON design_os.pricing_snapshot FOR EACH ROW
  EXECUTE FUNCTION design_os.check_snapshot_sources('bom_snapshot_id', 'bom_snapshot', 'boq_snapshot_id', 'boq_snapshot');
CREATE TRIGGER check_snapshot_sources BEFORE INSERT ON design_os.quotation_snapshot FOR EACH ROW
  EXECUTE FUNCTION design_os.check_snapshot_sources('boq_snapshot_id', 'boq_snapshot', 'pricing_snapshot_id', 'pricing_snapshot');

-- A new OUTPUT_GENERATION run is recorded only as evidence of a snapshot committed in the same transaction.
CREATE FUNCTION design_os.check_output_run_referenced() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $f$
BEGIN
  IF NOT (EXISTS (SELECT 1 FROM design_os.bom_snapshot WHERE validation_run_id = NEW.id)
       OR EXISTS (SELECT 1 FROM design_os.boq_snapshot WHERE validation_run_id = NEW.id)
       OR EXISTS (SELECT 1 FROM design_os.pricing_snapshot WHERE validation_run_id = NEW.id)
       OR EXISTS (SELECT 1 FROM design_os.quotation_snapshot WHERE validation_run_id = NEW.id)
       OR EXISTS (SELECT 1 FROM design_os.drawing_snapshot WHERE validation_run_id = NEW.id)
       OR EXISTS (SELECT 1 FROM design_os.manufacturing_document_snapshot WHERE validation_run_id = NEW.id)) THEN
    RAISE EXCEPTION 'design_os.validation_run: OUTPUT_GENERATION run % is not used by any snapshot of its transaction', NEW.id USING ERRCODE = 'LD906';
  END IF;
  RETURN NULL;
END $f$;
CREATE CONSTRAINT TRIGGER check_output_run_referenced AFTER INSERT ON design_os.validation_run DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.purpose = 'OUTPUT_GENERATION') EXECUTE FUNCTION design_os.check_output_run_referenced();

-- ---------------------------------------------------------------- drawing files: one-to-many, any registered format, sealed by a manifest
ALTER TABLE design_os.drawing_snapshot_file DROP CONSTRAINT drawing_snapshot_file_pkey, DROP CONSTRAINT drawing_snapshot_file_format_check,
  ADD COLUMN sequence integer NOT NULL CHECK (sequence >= 1),
  ADD COLUMN sheet_index integer CHECK (sheet_index >= 0),
  ADD CONSTRAINT drawing_snapshot_file_pkey PRIMARY KEY (snapshot_id, sequence),
  ADD CONSTRAINT drawing_snapshot_file_format_fk FOREIGN KEY (format) REFERENCES design_os.output_file_format (code),
  ADD CONSTRAINT drawing_snapshot_file_unique UNIQUE NULLS NOT DISTINCT (snapshot_id, format, sheet_index);

-- A file link must use a DRAWING format, with a sheet index exactly when the format is sheet-scoped. (A link added to
-- an existing snapshot later is refused at commit: the sealed manifest no longer matches, see check_drawing_manifest.)
CREATE FUNCTION design_os.check_snapshot_file() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $f$
DECLARE
  f design_os.output_file_format%ROWTYPE;
BEGIN
  SELECT * INTO f FROM design_os.output_file_format WHERE code = NEW.format;
  IF NOT FOUND OR NOT ('DRAWING' = ANY (f.kinds)) OR f.sheet_scoped <> (NEW.sheet_index IS NOT NULL) THEN
    RAISE EXCEPTION 'design_os.drawing_snapshot_file: format % / sheet index % is not valid for drawings', NEW.format, NEW.sheet_index USING ERRCODE = 'LD019';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER check_snapshot_file BEFORE INSERT ON design_os.drawing_snapshot_file FOR EACH ROW EXECUTE FUNCTION design_os.check_snapshot_file();

-- At commit: the linked files are exactly the sealed manifest, in deterministic sequence (format order, then sheet).
-- Manifest line: "<sequence>|<format>|<sheet index or empty>|<checksum>|<byte size>|<content type>", LF-joined, by sequence.
CREATE FUNCTION design_os.drawing_file_manifest_hash(p_snapshot uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $f$ SELECT design_os.sha256_text(string_agg(format('%s|%s|%s|%s|%s|%s', l.sequence, l.format, coalesce(l.sheet_index::text, ''), o.checksum, o.byte_size, o.content_type),
                                             E'\n' ORDER BY l.sequence))
        FROM design_os.drawing_snapshot_file l JOIN design_os.file_object o ON o.id = l.file_object_id AND o.org_id = l.org_id
        WHERE l.snapshot_id = p_snapshot $f$;
-- Fired (deferred) for a new drawing snapshot and for every new file link, so files can never be added to, missing
-- from or swapped in a snapshot, in the creating transaction or any later one.
CREATE FUNCTION design_os.check_drawing_manifest() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $f$
DECLARE
  snap uuid := CASE WHEN TG_TABLE_NAME = 'drawing_snapshot' THEN (to_jsonb(NEW) ->> 'id')::uuid ELSE (to_jsonb(NEW) ->> 'snapshot_id')::uuid END;
  sealed text;
BEGIN
  SELECT file_manifest_hash INTO sealed FROM design_os.drawing_snapshot WHERE id = snap;
  IF EXISTS (
      SELECT 1 FROM (SELECT l.sequence, row_number() OVER (ORDER BY f.sort_order, l.sheet_index NULLS FIRST) AS expected
                     FROM design_os.drawing_snapshot_file l JOIN design_os.output_file_format f ON f.code = l.format WHERE l.snapshot_id = snap) x
      WHERE x.sequence <> x.expected)
     OR design_os.drawing_file_manifest_hash(snap) IS DISTINCT FROM sealed THEN
    RAISE EXCEPTION 'design_os.drawing_snapshot: linked files do not match the sealed file manifest of snapshot %', snap USING ERRCODE = 'LD016';
  END IF;
  RETURN NULL;
END $f$;
CREATE CONSTRAINT TRIGGER check_drawing_manifest AFTER INSERT ON design_os.drawing_snapshot DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION design_os.check_drawing_manifest();
CREATE CONSTRAINT TRIGGER check_drawing_manifest AFTER INSERT ON design_os.drawing_snapshot_file DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION design_os.check_drawing_manifest();

-- ---------------------------------------------------------------- issuing a quotation locks its exact commercial basis
CREATE FUNCTION design_os.lock_issued_commercial_versions() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $f$
DECLARE
  s record;
BEGIN
  SELECT pricing_standard_version_id, quotation_policy_version_id INTO s FROM design_os.quotation_snapshot WHERE id = NEW.snapshot_id AND org_id = NEW.org_id;
  PERFORM set_config('design_os.reason', NEW.reason, true);
  PERFORM design_os.lock_cascade('pricing_standard', s.pricing_standard_version_id, NEW.org_id, NEW.issued_by, NEW.reason);
  PERFORM design_os.lock_cascade('quotation_policy', s.quotation_policy_version_id, NEW.org_id, NEW.issued_by, NEW.reason);
  RETURN NULL;
END $f$;
CREATE TRIGGER lock_issued_commercial_versions AFTER INSERT ON design_os.quotation_issue FOR EACH ROW EXECUTE FUNCTION design_os.lock_issued_commercial_versions();

REVOKE ALL ON FUNCTION design_os.sha256_text(text), design_os.dependency_set_hash(jsonb), design_os.commercial_input_hash(uuid, text, uuid, text),
  design_os.check_snapshot_sources(), design_os.check_output_run_referenced(), design_os.check_snapshot_file(), design_os.drawing_file_manifest_hash(uuid),
  design_os.check_drawing_manifest(), design_os.lock_issued_commercial_versions() FROM PUBLIC;
