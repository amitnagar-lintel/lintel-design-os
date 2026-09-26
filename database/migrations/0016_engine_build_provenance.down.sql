-- Revert 0016: restore the 0012 record_validation_run() and drop the engine build column.
SET LOCAL ROLE design_os_owner;

DROP FUNCTION design_os.record_validation_run(uuid, text, text, text, text, integer, integer, jsonb, text);

CREATE FUNCTION design_os.record_validation_run(p_design_version_id uuid, p_input_hash text, p_engine_version text, p_engine_hash text,
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
  INSERT INTO design_os.validation_run (org_id, design_version_id, input_hash, input_revision, engine_version, engine_hash, content_hash, blocker_count, warning_count, messages, created_by, created_at)
  VALUES (org, dv.id, dv.input_hash, dv.input_revision, p_engine_version, p_engine_hash, p_content_hash, p_blocker_count, p_warning_count, p_messages, actor, now())
  RETURNING id INTO run_id;
  RETURN run_id;
END $$;

REVOKE ALL ON FUNCTION design_os.record_validation_run(uuid, text, text, text, integer, integer, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION design_os.record_validation_run(uuid, text, text, text, integer, integer, jsonb, text) TO design_os_api;

ALTER TABLE design_os.validation_run DROP CONSTRAINT validation_run_engine_build_required;
ALTER TABLE design_os.validation_run DROP COLUMN engine_build;
