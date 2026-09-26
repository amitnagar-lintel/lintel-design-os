-- Rollback of 0018 issue finalization: the 0012 issue gate, the 0010 issue read policies, the original issue columns.
SET LOCAL ROLE design_os_owner;

DROP POLICY issue_read ON design_os.quotation_issue;
DROP POLICY issue_read ON design_os.drawing_issue;
CREATE POLICY issue_read ON design_os.quotation_issue FOR SELECT TO design_os_api USING (org_id = design_os.current_org_id() AND (design_os.is_internal() OR design_os.has_permission('output.read.issued')));
CREATE POLICY issue_read ON design_os.drawing_issue FOR SELECT TO design_os_api USING (org_id = design_os.current_org_id() AND (design_os.is_internal() OR design_os.has_permission('output.read.issued')));

CREATE OR REPLACE FUNCTION design_os.check_issue() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
DECLARE
  s record;
  dv design_os.design_version%ROWTYPE;
BEGIN
  EXECUTE format('SELECT kind, purpose, design_version_id, design_version_content_hash, blocker_count FROM design_os.%I WHERE id = $1 AND org_id = $2', TG_ARGV[0])
    INTO s USING NEW.snapshot_id, NEW.org_id;
  -- Only a purpose that qualifies for issue (FOR_PRODUCTION) can be issued; PRELIMINARY and FOR_REVIEW never can.
  IF NOT EXISTS (SELECT 1 FROM design_os.output_purpose_rule r WHERE r.kind = s.kind AND r.purpose = s.purpose AND r.qualifies_for_issue) THEN
    RAISE EXCEPTION 'design_os.%: only a FOR_PRODUCTION snapshot can be issued (snapshot purpose is %)', TG_TABLE_NAME, s.purpose
      USING ERRCODE = 'LD017', DETAIL = jsonb_build_object('purpose', s.purpose)::text;
  END IF;
  SELECT * INTO dv FROM design_os.design_version WHERE id = s.design_version_id AND org_id = NEW.org_id;
  IF dv.status IS DISTINCT FROM 'LOCKED' OR s.blocker_count > 0 OR s.design_version_content_hash <> dv.content_hash THEN
    RAISE EXCEPTION 'design_os.%: issuing requires a LOCKED design version, 0 BLOCKERs and a snapshot of the locked content', TG_TABLE_NAME USING ERRCODE = 'LD017', DETAIL = jsonb_build_object('status', dv.status, 'blockerCount', s.blocker_count)::text;
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE design_os.quotation_issue
  DROP CONSTRAINT quotation_issue_revision_unique,
  DROP CONSTRAINT quotation_issue_design_version_fk,
  DROP CONSTRAINT quotation_issue_project_fk,
  DROP COLUMN quotation_policy_version_id,
  DROP COLUMN pricing_standard_version_id,
  DROP COLUMN content_hash,
  DROP COLUMN revision_number,
  DROP COLUMN design_version_id,
  DROP COLUMN project_id;
ALTER TABLE design_os.drawing_issue
  DROP CONSTRAINT drawing_issue_number_revision_unique,
  DROP CONSTRAINT drawing_issue_design_version_fk,
  DROP CONSTRAINT drawing_issue_project_fk,
  DROP COLUMN file_manifest_hash,
  DROP COLUMN content_hash,
  DROP COLUMN drawing_revision,
  DROP COLUMN drawing_number,
  DROP COLUMN design_version_id,
  DROP COLUMN project_id;

ALTER TABLE design_os.error_code DISABLE TRIGGER forbid_mutation;
DELETE FROM design_os.error_code WHERE sqlstate = 'LD027';
ALTER TABLE design_os.error_code ENABLE TRIGGER forbid_mutation;
