-- 0009 audit (M5 §5, requirement F): append-only audit log with a per-organization SHA-256 hash chain.
-- No update / delete / truncate path exists for audit rows. Hashing here is integrity, not calculation.
SET LOCAL ROLE design_os_owner;

CREATE TABLE design_os.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid,
  occurred_at timestamptz NOT NULL,
  actor_user_id uuid,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  table_name text NOT NULL,
  row_id text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  request_id text,
  prev_hash text,
  row_hash text NOT NULL CHECK (row_hash ~ '^sha256:[0-9a-f]{64}$')
);
CREATE INDEX audit_log_chain ON design_os.audit_log (org_id, id);

-- Canonical text of one audit entry (timestamps rendered in UTC so verification is session-independent).
CREATE FUNCTION design_os.audit_canonical(p_org uuid, p_at timestamptz, p_actor uuid, p_action text, p_table text, p_row text, p_old jsonb, p_new jsonb, p_reason text, p_request text)
  RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$
    SELECT jsonb_build_object('org_id', p_org, 'occurred_at', to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'actor_user_id', p_actor,
      'action', p_action, 'table_name', p_table, 'row_id', p_row, 'old_value', p_old, 'new_value', p_new, 'reason', p_reason, 'request_id', p_request)::text
  $$;

CREATE FUNCTION design_os.audit_chain_hash(p_prev text, p_canonical text) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT 'sha256:' || encode(sha256(convert_to(coalesce(p_prev, '') || '|' || p_canonical, 'UTF8')), 'hex') $$;

-- One row per change: who (verified claims), what (table, row, only changed columns for UPDATE), when, why.
CREATE FUNCTION design_os.audit_row() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  rowj jsonb := coalesce(n, o);
  org uuid := coalesce((rowj ->> 'org_id')::uuid, CASE WHEN TG_TABLE_NAME = 'organization' THEN (rowj ->> 'id')::uuid END);
  oldv jsonb := o;
  newv jsonb := n;
  at timestamptz := clock_timestamp();
  actor uuid := design_os.current_user_id();
  reason text := nullif(current_setting('design_os.reason', true), '');
  request text := nullif(current_setting('design_os.request_id', true), '');
  prev text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(key, value) INTO oldv FROM jsonb_each(o) WHERE n -> key IS DISTINCT FROM value;
    SELECT jsonb_object_agg(key, value) INTO newv FROM jsonb_each(n) WHERE o -> key IS DISTINCT FROM value;
    IF oldv IS NULL AND newv IS NULL THEN
      RETURN NULL;
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('design_os.audit:' || coalesce(org::text, 'global'), 0));
  SELECT row_hash INTO prev FROM design_os.audit_log WHERE org_id IS NOT DISTINCT FROM org ORDER BY id DESC LIMIT 1;
  INSERT INTO design_os.audit_log (org_id, occurred_at, actor_user_id, action, table_name, row_id, old_value, new_value, reason, request_id, prev_hash, row_hash)
  VALUES (org, at, actor, TG_OP, TG_TABLE_NAME, rowj ->> 'id', oldv, newv, reason, request, prev,
          design_os.audit_chain_hash(prev, design_os.audit_canonical(org, at, actor, TG_OP, TG_TABLE_NAME, rowj ->> 'id', oldv, newv, reason, request)));
  RETURN NULL;
END $$;

CREATE FUNCTION design_os.forbid_truncate() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'design_os.%: TRUNCATE is not allowed', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$;

SELECT design_os.install_insert_only('design_os.audit_log');
CREATE TRIGGER forbid_truncate BEFORE TRUNCATE ON design_os.audit_log FOR EACH STATEMENT EXECUTE FUNCTION design_os.forbid_truncate();

-- Recompute an organization's chain; returns the first broken entry (NULL when intact).
CREATE FUNCTION design_os.verify_audit_chain(p_org uuid) RETURNS TABLE (ok boolean, checked bigint, first_bad_id bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
DECLARE
  a design_os.audit_log%ROWTYPE;
  prev text := NULL;
  n bigint := 0;
BEGIN
  FOR a IN SELECT * FROM design_os.audit_log WHERE org_id IS NOT DISTINCT FROM p_org ORDER BY id LOOP
    n := n + 1;
    IF a.prev_hash IS DISTINCT FROM prev OR a.row_hash <> design_os.audit_chain_hash(prev,
         design_os.audit_canonical(a.org_id, a.occurred_at, a.actor_user_id, a.action, a.table_name, a.row_id, a.old_value, a.new_value, a.reason, a.request_id)) THEN
      RETURN QUERY SELECT false, n, a.id;
      RETURN;
    END IF;
    prev := a.row_hash;
  END LOOP;
  RETURN QUERY SELECT true, n, NULL::bigint;
END $$;

-- Tables that are schema (registries / seeds) are not audited; everything else is.
CREATE FUNCTION design_os.unaudited_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT ARRAY['audit_log', 'versioned_table', 'role', 'permission', 'default_role_permission', 'construction_variable', 'planning_variable', 'manufacturing_variable'] $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'design_os' AND tablename <> ALL (design_os.unaudited_tables()) ORDER BY tablename LOOP
    EXECUTE format('CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON design_os.%I FOR EACH ROW EXECUTE FUNCTION design_os.audit_row()', t);
  END LOOP;
END $$;
