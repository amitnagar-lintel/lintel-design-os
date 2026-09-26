-- 0001 foundation: schema, roles, lifecycle type, claim helpers, integrity trigger functions,
-- the versioned-table registry and the version-envelope installer.
-- Integrity only: nothing here calculates geometry, construction, BOM, BOQ, price or drawings.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'design_os_owner') THEN
    CREATE ROLE design_os_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'design_os_api') THEN
    CREATE ROLE design_os_api NOLOGIN;
  END IF;
END $$;

GRANT design_os_owner TO CURRENT_USER;
CREATE SCHEMA design_os AUTHORIZATION design_os_owner;
REVOKE ALL ON SCHEMA design_os FROM PUBLIC;

-- Every object below is owned by design_os_owner (owner bypasses RLS; SECURITY DEFINER runs as owner).
SET LOCAL ROLE design_os_owner;

-- Exact persisted lifecycle (M5 §4). CHANGES_REQUIRED is a decision, never a status (D2).
CREATE TYPE design_os.record_lifecycle_status AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'LOCKED', 'SUPERSEDED');
CREATE TYPE design_os.design_os_role AS ENUM ('ADMIN', 'DESIGNER', 'DESIGN_HEAD', 'SALES', 'COSTING', 'FINANCE', 'PROCUREMENT', 'PRODUCTION', 'SITE_ENGINEER', 'CLIENT');
CREATE TYPE design_os.identity_kind AS ENUM ('INTERNAL', 'CLIENT');
CREATE TYPE design_os.snapshot_kind AS ENUM ('BOM', 'BOQ', 'PRICING', 'QUOTATION', 'DRAWING', 'MANUFACTURING_DOCUMENT');

-- JWT claims set per transaction by the API (`set_config('request.jwt.claims', ..., true)`). Never trusted for org:
-- the org is only accepted after a membership check (current_org_id, 0002).
CREATE FUNCTION design_os.claims() RETURNS jsonb
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;

CREATE FUNCTION design_os.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(design_os.claims() ->> 'sub', '')::uuid $$;

-- Insert-only tables (snapshots, files, room revisions, validation runs, decisions, audit).
CREATE FUNCTION design_os.forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'design_os.%: rows are insert-only (% refused)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'integrity_constraint_violation';
END $$;

-- Lifecycle columns change only through design_os.transition() (runs as design_os_owner).
CREATE FUNCTION design_os.lifecycle_columns() RETURNS text[]
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT ARRAY['status', 'submitted_by', 'submitted_at', 'approved_by', 'approved_at', 'effective_from', 'locked_by', 'locked_at', 'superseded_by', 'superseded_at'] $$;

-- Guard on every versioned table: new versions start as DRAFT; content is editable only while DRAFT;
-- lifecycle columns change only inside the transition function; non-DRAFT versions are never deleted.
CREATE FUNCTION design_os.guard_version_row() RETURNS trigger
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

-- Guard on content rows (values, rules, members, objects, overrides): editable only while the
-- owning version is DRAFT. TG_ARGV[0] = parent version table, TG_ARGV[1] = foreign-key column.
CREATE FUNCTION design_os.guard_draft_content() RETURNS trigger
  LANGUAGE plpgsql
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

-- Registry of versioned tables (subject types for approval, audit and RLS). Filled by install_version_envelope.
CREATE TABLE design_os.versioned_table (
  subject_type text PRIMARY KEY,
  version_table regclass NOT NULL UNIQUE,
  entity_table regclass NOT NULL,
  author_action text NOT NULL,
  approve_action text NOT NULL
);

-- Adds the identical version-envelope columns, constraints and guard to one version table (M5 §2.1,
-- requirement A). One definition, many tables: no generic "standard" table is created.
-- Expects the table to already have: id uuid PK, org_id uuid, entity_id uuid.
CREATE FUNCTION design_os.install_version_envelope(p_subject_type text, p_version regclass, p_entity regclass, p_author text, p_approve text) RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  t text := p_version::text;
  n text := split_part(p_version::text, '.', 2);
BEGIN
  EXECUTE format($f$
    ALTER TABLE %1$s
      ADD COLUMN version_number integer NOT NULL CHECK (version_number >= 1),
      ADD COLUMN version_label text,
      ADD COLUMN status design_os.record_lifecycle_status NOT NULL DEFAULT 'DRAFT',
      ADD COLUMN data_classification text NOT NULL DEFAULT 'PRODUCTION' CONSTRAINT %2$s_production_only CHECK (data_classification = 'PRODUCTION'),
      ADD COLUMN source text NOT NULL CONSTRAINT %2$s_source_required CHECK (btrim(source) <> ''),
      ADD COLUMN source_ref jsonb,
      ADD COLUMN change_reason text NOT NULL CONSTRAINT %2$s_reason_required CHECK (btrim(change_reason) <> ''),
      ADD COLUMN created_by uuid NOT NULL REFERENCES design_os.app_user (id),
      ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN submitted_by uuid REFERENCES design_os.app_user (id),
      ADD COLUMN submitted_at timestamptz,
      ADD COLUMN approved_by uuid REFERENCES design_os.app_user (id),
      ADD COLUMN approved_at timestamptz,
      ADD COLUMN effective_from timestamptz,
      ADD COLUMN locked_by uuid REFERENCES design_os.app_user (id),
      ADD COLUMN locked_at timestamptz,
      ADD COLUMN superseded_by uuid,
      ADD COLUMN superseded_at timestamptz,
      ADD COLUMN content_hash text NOT NULL CONSTRAINT %2$s_content_hash_format CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
      ADD COLUMN row_version integer NOT NULL DEFAULT 1,
      ADD CONSTRAINT %2$s_version_number_unique UNIQUE (org_id, entity_id, version_number),
      ADD CONSTRAINT %2$s_org_entity_id_unique UNIQUE (org_id, entity_id, id),
      ADD CONSTRAINT %2$s_org_id_unique UNIQUE (org_id, id),
      ADD CONSTRAINT %2$s_entity_fk FOREIGN KEY (org_id, entity_id) REFERENCES %3$s (org_id, id),
      -- The successor is an exact VERSION row of the same entity, same tenant, same table.
      ADD CONSTRAINT %2$s_superseded_by_fk FOREIGN KEY (org_id, entity_id, superseded_by) REFERENCES %1$s (org_id, entity_id, id),
      ADD CONSTRAINT %2$s_not_self_superseded CHECK (superseded_by IS NULL OR superseded_by <> id),
      ADD CONSTRAINT %2$s_submitted_iff CHECK ((status = 'DRAFT') = (submitted_by IS NULL AND submitted_at IS NULL) AND (submitted_by IS NULL) = (submitted_at IS NULL)),
      ADD CONSTRAINT %2$s_approved_iff CHECK ((status IN ('APPROVED', 'LOCKED', 'SUPERSEDED')) = (approved_by IS NOT NULL AND approved_at IS NOT NULL AND effective_from IS NOT NULL)),
      ADD CONSTRAINT %2$s_approver_not_submitter CHECK (approved_by IS NULL OR approved_by <> submitted_by),
      ADD CONSTRAINT %2$s_locked_iff CHECK ((locked_by IS NULL) = (locked_at IS NULL) AND (status <> 'LOCKED' OR locked_by IS NOT NULL) AND (status NOT IN ('DRAFT', 'IN_REVIEW', 'APPROVED') OR locked_by IS NULL)),
      ADD CONSTRAINT %2$s_superseded_iff CHECK ((status = 'SUPERSEDED') = (superseded_by IS NOT NULL AND superseded_at IS NOT NULL))
  $f$, t, n, p_entity::text);
  EXECUTE format('CREATE TRIGGER guard_version_row BEFORE INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION design_os.guard_version_row()', t);
  INSERT INTO design_os.versioned_table (subject_type, version_table, entity_table, author_action, approve_action)
  VALUES (p_subject_type, p_version, p_entity, p_author, p_approve);
END $$;

-- Content-row guard installer (see guard_draft_content).
CREATE FUNCTION design_os.install_draft_guard(p_table regclass, p_parent regclass, p_fk text) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER guard_draft_content BEFORE INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION design_os.guard_draft_content(%L, %L)', p_table, p_parent::text, p_fk);
END $$;

CREATE FUNCTION design_os.install_insert_only(p_table regclass) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER forbid_mutation BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION design_os.forbid_mutation()', p_table);
END $$;
