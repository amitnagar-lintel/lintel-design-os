-- 0018 issue finalization (M5 Step 7 checkpoint 4).
--  1. An issue record is a complete, immutable decision record: project, design version, snapshot, revision (quotation
--     revision number; drawing number + revision), the exact content hash, and for quotations the exact PricingStandard
--     and QuotationPolicy versions; for drawings the sealed file manifest. The database derives every column from the
--     snapshot; a caller-declared value (content hash, commercial versions) must equal it.
--  2. check_issue also requires: current engineering inputs and dependency content (nothing changed since generation),
--     APPROVED / LOCKED engineering dependencies, 0 BLOCKERs in the output-generation evidence, a complete output,
--     APPROVED / LOCKED commercial versions, and project access. Issue timestamps are the database's.
--  3. A snapshot is issued at most once (LD027 ALREADY_ISSUED); a drawing number + revision is issued at most once per
--     project; a quotation revision at most once per design version.
--  4. Issue records are readable by internal members, and by CLIENT members only for their own projects.
-- Integrity only; the output engines stay the calculation authority.
SET LOCAL ROLE design_os_owner;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM design_os.quotation_issue) OR EXISTS (SELECT 1 FROM design_os.drawing_issue) THEN
    RAISE EXCEPTION '0018: issue records exist; the issue model can only be migrated before anything is issued';
  END IF;
END $$;

INSERT INTO design_os.error_code (sqlstate, code, http_status, api_facing, description) VALUES
  ('LD027', 'ALREADY_ISSUED', 409, true, 'The snapshot, quotation revision or drawing number and revision has already been issued; issues are immutable');

-- ---------------------------------------------------------------- decision-record columns (derived from the snapshot by check_issue)
ALTER TABLE design_os.quotation_issue
  ADD COLUMN project_id uuid NOT NULL,
  ADD COLUMN design_version_id uuid NOT NULL,
  ADD COLUMN revision_number integer NOT NULL CHECK (revision_number >= 1),
  ADD COLUMN content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  ADD COLUMN pricing_standard_version_id uuid NOT NULL,
  ADD COLUMN quotation_policy_version_id uuid NOT NULL,
  ADD CONSTRAINT quotation_issue_project_fk FOREIGN KEY (org_id, project_id) REFERENCES design_os.project (org_id, id),
  ADD CONSTRAINT quotation_issue_design_version_fk FOREIGN KEY (org_id, design_version_id) REFERENCES design_os.design_version (org_id, id),
  ADD CONSTRAINT quotation_issue_revision_unique UNIQUE (org_id, design_version_id, revision_number);

ALTER TABLE design_os.drawing_issue
  ADD COLUMN project_id uuid NOT NULL,
  ADD COLUMN design_version_id uuid NOT NULL,
  ADD COLUMN drawing_number text NOT NULL,
  ADD COLUMN drawing_revision text NOT NULL,
  ADD COLUMN content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  ADD COLUMN file_manifest_hash text NOT NULL CHECK (file_manifest_hash ~ '^sha256:[0-9a-f]{64}$'),
  ADD CONSTRAINT drawing_issue_project_fk FOREIGN KEY (org_id, project_id) REFERENCES design_os.project (org_id, id),
  ADD CONSTRAINT drawing_issue_design_version_fk FOREIGN KEY (org_id, design_version_id) REFERENCES design_os.design_version (org_id, id),
  ADD CONSTRAINT drawing_issue_number_revision_unique UNIQUE (org_id, project_id, drawing_number, drawing_revision);

-- ---------------------------------------------------------------- the issue gate
CREATE OR REPLACE FUNCTION design_os.check_issue() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
DECLARE
  s jsonb;
  dv design_os.design_version%ROWTYPE;
  run design_os.validation_run%ROWTYPE;
  expected jsonb;
  problems text[] := ARRAY[]::text[];
  d record;
  st design_os.record_lifecycle_status;
  is_quotation boolean := TG_TABLE_NAME = 'quotation_issue';
BEGIN
  EXECUTE format('SELECT to_jsonb(t) FROM design_os.%I t WHERE id = $1 AND org_id = $2', TG_ARGV[0]) INTO s USING NEW.snapshot_id, NEW.org_id;
  IF s IS NULL THEN
    RAISE EXCEPTION 'design_os.%: snapshot % not found in this organization', TG_TABLE_NAME, NEW.snapshot_id USING ERRCODE = 'LD005';
  END IF;
  SELECT * INTO dv FROM design_os.design_version WHERE id = (s ->> 'design_version_id')::uuid AND org_id = NEW.org_id;
  -- The issuer must be able to access the project (RLS alone checks only the action).
  IF design_os.current_user_id() IS NOT NULL AND NOT design_os.can_access_project(dv.project_id) THEN
    RAISE EXCEPTION 'design_os.%: snapshot % not found in this organization', TG_TABLE_NAME, NEW.snapshot_id USING ERRCODE = 'LD005';
  END IF;
  -- One issue per snapshot (the primary key is the final guard under concurrency).
  IF EXISTS (SELECT 1 FROM design_os.quotation_issue WHERE is_quotation AND snapshot_id = NEW.snapshot_id)
     OR EXISTS (SELECT 1 FROM design_os.drawing_issue WHERE NOT is_quotation AND snapshot_id = NEW.snapshot_id) THEN
    RAISE EXCEPTION 'design_os.%: snapshot % is already issued', TG_TABLE_NAME, NEW.snapshot_id USING ERRCODE = 'LD027';
  END IF;
  -- Only a purpose that qualifies for issue (FOR_PRODUCTION) can be issued; PRELIMINARY and FOR_REVIEW never can.
  IF NOT EXISTS (SELECT 1 FROM design_os.output_purpose_rule r WHERE r.kind = (s ->> 'kind')::design_os.snapshot_kind AND r.purpose = s ->> 'purpose' AND r.qualifies_for_issue) THEN
    RAISE EXCEPTION 'design_os.%: only a FOR_PRODUCTION snapshot can be issued (snapshot purpose is %)', TG_TABLE_NAME, s ->> 'purpose'
      USING ERRCODE = 'LD017', DETAIL = jsonb_build_object('purpose', s ->> 'purpose')::text;
  END IF;
  -- The design version must be LOCKED now (DRAFT, IN_REVIEW, APPROVED and SUPERSEDED are refused) and still be the content the snapshot was made from.
  IF dv.status IS DISTINCT FROM 'LOCKED' OR (s ->> 'blocker_count')::int > 0 OR s ->> 'design_version_content_hash' <> dv.content_hash THEN
    RAISE EXCEPTION 'design_os.%: issuing requires a LOCKED design version, 0 BLOCKERs and a snapshot of the locked content', TG_TABLE_NAME
      USING ERRCODE = 'LD017', DETAIL = jsonb_build_object('status', dv.status, 'blockerCount', (s ->> 'blocker_count')::int)::text;
  END IF;

  -- Exact, still-valid inputs: the engineering input revision, the content of every exact dependency version, the evidence.
  IF s ->> 'input_hash' <> dv.input_hash OR (s ->> 'input_revision')::bigint <> dv.input_revision THEN
    problems := problems || 'the engineering inputs changed after the snapshot was generated'::text;
  END IF;
  expected := design_os.engineering_dependency_hashes(NEW.org_id, dv.id);
  IF s ->> 'pricing_standard_version_id' IS NOT NULL THEN
    expected := expected || jsonb_build_object('pricing_standard_version_id', coalesce(design_os.version_content_hash('pricing_standard', (s ->> 'pricing_standard_version_id')::uuid, NEW.org_id), 'MISSING'));
  END IF;
  IF s ->> 'quotation_policy_version_id' IS NOT NULL THEN
    expected := expected || jsonb_build_object('quotation_policy_version_id', coalesce(design_os.version_content_hash('quotation_policy', (s ->> 'quotation_policy_version_id')::uuid, NEW.org_id), 'MISSING'));
  END IF;
  IF (s -> 'dependency_hashes') IS DISTINCT FROM expected THEN
    problems := problems || 'the content of an exact dependency version changed after the snapshot was generated'::text;
  END IF;
  FOR d IN SELECT * FROM design_os.version_dependencies('design', dv.id, NEW.org_id) WHERE dep_version_id IS NOT NULL LOOP
    st := design_os.version_status(d.dep_subject_type, d.dep_version_id, NEW.org_id);
    IF st IS NULL OR st NOT IN ('APPROVED', 'LOCKED') THEN
      problems := problems || format('engineering dependency %s %s is %s', d.dep_subject_type, d.dep_version_id, coalesce(st::text, 'missing'));
    END IF;
  END LOOP;
  SELECT * INTO run FROM design_os.validation_run WHERE id = (s ->> 'validation_run_id')::uuid AND org_id = NEW.org_id;
  IF NOT FOUND OR run.blocker_count > 0 THEN problems := problems || 'the output-generation validation has BLOCKERs'::text; END IF;
  IF NOT (s ->> 'output_complete')::boolean THEN problems := problems || 'the output is incomplete'::text; END IF;
  IF is_quotation THEN
    FOREACH st IN ARRAY ARRAY[design_os.version_status('pricing_standard', (s ->> 'pricing_standard_version_id')::uuid, NEW.org_id),
                              design_os.version_status('quotation_policy', (s ->> 'quotation_policy_version_id')::uuid, NEW.org_id)] LOOP
      IF st IS NULL OR st NOT IN ('APPROVED', 'LOCKED') THEN problems := problems || format('a commercial version is %s', coalesce(st::text, 'missing')); END IF;
    END LOOP;
  END IF;

  -- The decision record: derived from the snapshot; a value the caller declared must be exactly the snapshot's.
  IF NEW.content_hash IS NOT NULL AND NEW.content_hash <> s ->> 'content_hash' THEN problems := problems || 'content_hash is not the snapshot''s content hash'::text; END IF;
  IF NEW.project_id IS NOT NULL AND NEW.project_id <> dv.project_id THEN problems := problems || 'project_id is not the snapshot''s project'::text; END IF;
  IF NEW.design_version_id IS NOT NULL AND NEW.design_version_id <> dv.id THEN problems := problems || 'design_version_id is not the snapshot''s design version'::text; END IF;
  NEW.project_id := dv.project_id;
  NEW.design_version_id := dv.id;
  NEW.content_hash := s ->> 'content_hash';
  NEW.issued_at := now();
  IF is_quotation THEN
    IF to_jsonb(NEW) ->> 'pricing_standard_version_id' IS NOT NULL AND to_jsonb(NEW) ->> 'pricing_standard_version_id' <> s ->> 'pricing_standard_version_id' THEN
      problems := problems || 'pricing_standard_version_id is not the PricingStandard version the quotation was priced with'::text;
    END IF;
    IF to_jsonb(NEW) ->> 'quotation_policy_version_id' IS NOT NULL AND to_jsonb(NEW) ->> 'quotation_policy_version_id' <> s ->> 'quotation_policy_version_id' THEN
      problems := problems || 'quotation_policy_version_id is not the QuotationPolicy version of the quotation'::text;
    END IF;
    IF to_jsonb(NEW) ->> 'revision_number' IS NOT NULL AND (to_jsonb(NEW) ->> 'revision_number')::int <> (s ->> 'revision_number')::int THEN
      problems := problems || 'revision_number is not the quotation''s revision'::text;
    END IF;
    NEW := jsonb_populate_record(NEW, jsonb_build_object('revision_number', (s ->> 'revision_number')::int,
      'pricing_standard_version_id', s ->> 'pricing_standard_version_id', 'quotation_policy_version_id', s ->> 'quotation_policy_version_id'));
  ELSE
    NEW := jsonb_populate_record(NEW, jsonb_build_object('drawing_number', s ->> 'drawing_number', 'drawing_revision', s ->> 'drawing_revision',
      'file_manifest_hash', s ->> 'file_manifest_hash'));
  END IF;

  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION 'design_os.%: issue preconditions failed: %', TG_TABLE_NAME, array_to_string(problems, '; ')
      USING ERRCODE = 'LD017', DETAIL = jsonb_build_object('problems', to_jsonb(problems))::text;
  END IF;
  -- The same quotation revision / drawing number + revision is issued at most once (the unique constraints are the final guard).
  IF (is_quotation AND EXISTS (SELECT 1 FROM design_os.quotation_issue q WHERE q.org_id = NEW.org_id AND q.design_version_id = dv.id AND q.revision_number = (s ->> 'revision_number')::int))
     OR (NOT is_quotation AND EXISTS (SELECT 1 FROM design_os.drawing_issue i WHERE i.org_id = NEW.org_id AND i.project_id = dv.project_id
                                      AND i.drawing_number = s ->> 'drawing_number' AND i.drawing_revision = s ->> 'drawing_revision')) THEN
    RAISE EXCEPTION 'design_os.%: this revision is already issued', TG_TABLE_NAME USING ERRCODE = 'LD027';
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------- client visibility: issue records of the client's own projects only
DROP POLICY issue_read ON design_os.quotation_issue;
DROP POLICY issue_read ON design_os.drawing_issue;
CREATE POLICY issue_read ON design_os.quotation_issue FOR SELECT TO design_os_api
  USING (org_id = design_os.current_org_id() AND (design_os.is_internal() OR (design_os.has_permission('output.read.issued') AND design_os.can_access_project(project_id))));
CREATE POLICY issue_read ON design_os.drawing_issue FOR SELECT TO design_os_api
  USING (org_id = design_os.current_org_id() AND (design_os.is_internal() OR (design_os.has_permission('output.read.issued') AND design_os.can_access_project(project_id))));
