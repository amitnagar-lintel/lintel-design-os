-- 0013 idempotency and request context (M5 Step 4, OD-2 and the tenant-context correction).
--
-- 1. design_os.current_memberships(): the caller's own ACTIVE memberships, derived only from auth.uid(), so the
--    API can verify that an X-Org header names one of them BEFORE it establishes an org context. X-Org never
--    establishes authorization by itself; design_os.current_org_id() re-verifies the chosen org afterwards.
-- 2. design_os.idempotency_record + claim/complete functions: an operation with an Idempotency-Key executes at
--    most once per (org, scope, key). Uniqueness is enforced by the database. The claim and the operation's
--    effect commit or roll back together, and a claim can only commit once it is COMPLETED.
SET LOCAL ROLE design_os_owner;

-- ---------------------------------------------------------------- current_memberships()

-- Minimum data for organization selection: the org ids only. Nothing about other users, inactive memberships,
-- disabled users or suspended organizations is ever returned. No parameters: the identity comes from auth.uid().
CREATE FUNCTION design_os.current_memberships() RETURNS TABLE (org_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT DISTINCT m.org_id
    FROM design_os.org_membership m
      JOIN design_os.app_user u ON u.id = m.user_id
      JOIN design_os.organization o ON o.id = m.org_id
    WHERE auth.uid() IS NOT NULL
      AND m.user_id = auth.uid()
      AND m.status = 'ACTIVE' AND u.status = 'ACTIVE' AND o.status = 'ACTIVE'
    ORDER BY m.org_id
  $$;
REVOKE ALL ON FUNCTION design_os.current_memberships() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION design_os.current_memberships() TO design_os_api;

-- ---------------------------------------------------------------- idempotency

CREATE TABLE design_os.idempotency_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  -- The operation. A fixed list: the same key can never be reused across unrelated operations by accident.
  scope text NOT NULL CHECK (scope IN (
    'transition', 'validation_run.record',
    'snapshot.bom.generate', 'snapshot.boq.generate', 'snapshot.pricing.generate', 'snapshot.quotation.generate',
    'snapshot.drawing.generate', 'snapshot.manufacturing_document.generate',
    'quotation.issue', 'drawing.issue', 'manufacturing.release',
    'file.upload', 'client_contact.invite')),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[!-~]{16,128}$'),
  actor_user_id uuid NOT NULL REFERENCES design_os.app_user (id),
  -- sha256 over the canonical request: method, normalized route/operation, user, org, path/query params, body.
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  response_status smallint CHECK (response_status BETWEEN 200 AND 299),
  response_body jsonb CHECK (response_body IS NULL OR octet_length(response_body::text) <= 65536),
  resource_type text CHECK (resource_type IS NULL OR resource_type ~ '^[a-z][a-z0-9_]*$'),
  resource_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  CONSTRAINT idempotency_record_key UNIQUE (org_id, scope, idempotency_key),
  CONSTRAINT idempotency_record_expiry CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days'),
  CONSTRAINT idempotency_record_in_progress CHECK (status <> 'IN_PROGRESS' OR (response_status IS NULL AND response_body IS NULL AND resource_type IS NULL AND resource_id IS NULL AND completed_at IS NULL)),
  -- A completed record always carries the original result: a stored body or a durable reference to the created resource.
  CONSTRAINT idempotency_record_completed CHECK (status <> 'COMPLETED' OR (response_status IS NOT NULL AND completed_at IS NOT NULL
    AND (response_body IS NOT NULL OR (resource_type IS NOT NULL AND resource_id IS NOT NULL)))),
  CONSTRAINT idempotency_record_no_test_fixture CHECK (response_body IS NULL OR NOT jsonb_path_exists(response_body, 'lax $.** ? (@ == "TEST_FIXTURE" || @ == "TEST_FIXTURE_DATA_IN_USE")'))
);
CREATE INDEX idempotency_record_expires ON design_os.idempotency_record (expires_at);

-- Rows never move between orgs/scopes/keys or actors, and a COMPLETED result never changes. The only later
-- rewrite is the claim function replacing an EXPIRED record.
CREATE FUNCTION design_os.guard_idempotency_record() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'design_os.idempotency_record: records are never deleted by the application' USING ERRCODE = 'LD015';
  END IF;
  IF NEW.id <> OLD.id OR NEW.org_id <> OLD.org_id OR NEW.scope <> OLD.scope OR NEW.idempotency_key <> OLD.idempotency_key THEN
    RAISE EXCEPTION 'design_os.idempotency_record: the record identity is immutable' USING ERRCODE = 'LD015';
  END IF;
  IF OLD.status = 'COMPLETED' AND OLD.expires_at > now() THEN
    RAISE EXCEPTION 'design_os.idempotency_record: a completed, unexpired result is immutable' USING ERRCODE = 'LD015';
  END IF;
  IF OLD.status = 'IN_PROGRESS' AND (NEW.actor_user_id <> OLD.actor_user_id OR NEW.request_hash <> OLD.request_hash OR NEW.created_at <> OLD.created_at OR NEW.expires_at <> OLD.expires_at) THEN
    RAISE EXCEPTION 'design_os.idempotency_record: an in-progress claim cannot be re-bound' USING ERRCODE = 'LD015';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_idempotency_record BEFORE UPDATE OR DELETE ON design_os.idempotency_record
  FOR EACH ROW EXECUTE FUNCTION design_os.guard_idempotency_record();

-- A claim may only commit once completed: an IN_PROGRESS record is never visible to another transaction, so a
-- duplicate either waits for the original to finish or gets IDEMPOTENCY_IN_PROGRESS — it never re-executes.
CREATE FUNCTION design_os.check_idempotency_completed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM design_os.idempotency_record WHERE id = NEW.id AND status <> 'COMPLETED') THEN
    RAISE EXCEPTION 'design_os.idempotency_record: claim % was not completed before commit', NEW.id USING ERRCODE = 'LD905';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER idempotency_must_complete AFTER INSERT OR UPDATE ON design_os.idempotency_record
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION design_os.check_idempotency_completed();

-- Claim (org, scope, key) for the current identity and org, inside the caller's transaction.
--   outcome 'EXECUTE' → first request: run the operation, then call complete_idempotency() in the same transaction.
--   outcome 'REPLAY'  → identical request already completed: return the stored result; do NOT run the operation.
-- Same key with a different request hash (or another actor) → LD022 IDEMPOTENCY_CONFLICT.
-- The same key still executing in another transaction → wait up to lock_timeout, then LD023 IDEMPOTENCY_IN_PROGRESS.
CREATE FUNCTION design_os.claim_idempotency(p_scope text, p_idempotency_key text, p_request_hash text, p_ttl interval DEFAULT interval '24 hours')
  RETURNS TABLE (outcome text, record_id uuid, response_status smallint, response_body jsonb, resource_type text, resource_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '5s'
  AS $$
DECLARE
  actor uuid := design_os.current_user_id();
  org uuid := design_os.current_org_id();
  rec design_os.idempotency_record%ROWTYPE;
  new_id uuid;
BEGIN
  IF actor IS NULL OR org IS NULL THEN
    RAISE EXCEPTION 'claim_idempotency: an authenticated, active member of the organization is required' USING ERRCODE = 'LD002';
  END IF;
  IF p_ttl IS NULL OR p_ttl <= interval '0' OR p_ttl > interval '7 days' THEN
    RAISE EXCEPTION 'claim_idempotency: ttl must be positive and at most 7 days' USING ERRCODE = 'LD020';
  END IF;
  BEGIN
    INSERT INTO design_os.idempotency_record AS r (org_id, scope, idempotency_key, actor_user_id, request_hash, expires_at)
    VALUES (org, p_scope, p_idempotency_key, actor, p_request_hash, now() + p_ttl)
    ON CONFLICT (org_id, scope, idempotency_key) DO NOTHING
    RETURNING r.id INTO new_id;
    IF new_id IS NULL THEN
      SELECT * INTO rec FROM design_os.idempotency_record r
        WHERE r.org_id = org AND r.scope = p_scope AND r.idempotency_key = p_idempotency_key FOR UPDATE;
    END IF;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'claim_idempotency: the same idempotency key is still executing' USING ERRCODE = 'LD023';
  END;
  IF new_id IS NOT NULL THEN
    RETURN QUERY SELECT 'EXECUTE'::text, new_id, NULL::smallint, NULL::jsonb, NULL::text, NULL::uuid;
    RETURN;
  END IF;
  IF rec.expires_at <= now() THEN
    -- Expired: the key is free again. Replace the old record with a fresh claim (same row, new binding).
    UPDATE design_os.idempotency_record r
      SET actor_user_id = actor, request_hash = p_request_hash, status = 'IN_PROGRESS', response_status = NULL, response_body = NULL,
          resource_type = NULL, resource_id = NULL, created_at = now(), completed_at = NULL, expires_at = now() + p_ttl
      WHERE r.id = rec.id;
    RETURN QUERY SELECT 'EXECUTE'::text, rec.id, NULL::smallint, NULL::jsonb, NULL::text, NULL::uuid;
    RETURN;
  END IF;
  IF rec.actor_user_id <> actor OR rec.request_hash <> p_request_hash THEN
    RAISE EXCEPTION 'claim_idempotency: the idempotency key was already used for a different request' USING ERRCODE = 'LD022';
  END IF;
  IF rec.status <> 'COMPLETED' THEN
    -- Only reachable inside the claiming transaction itself (a repeated claim before completion).
    RAISE EXCEPTION 'claim_idempotency: the same idempotency key is still executing' USING ERRCODE = 'LD023';
  END IF;
  RETURN QUERY SELECT 'REPLAY'::text, rec.id, rec.response_status, rec.response_body, rec.resource_type, rec.resource_id;
END $$;

-- Complete a claim made in this transaction by the same identity and org, storing the original result.
CREATE FUNCTION design_os.complete_idempotency(p_record_id uuid, p_response_status smallint, p_response_body jsonb, p_resource_type text, p_resource_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  actor uuid := design_os.current_user_id();
  org uuid := design_os.current_org_id();
BEGIN
  IF actor IS NULL OR org IS NULL THEN
    RAISE EXCEPTION 'complete_idempotency: an authenticated, active member of the organization is required' USING ERRCODE = 'LD002';
  END IF;
  UPDATE design_os.idempotency_record r
    SET status = 'COMPLETED', response_status = p_response_status, response_body = p_response_body,
        resource_type = p_resource_type, resource_id = p_resource_id, completed_at = now()
    WHERE r.id = p_record_id AND r.org_id = org AND r.actor_user_id = actor AND r.status = 'IN_PROGRESS';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'complete_idempotency: no in-progress claim % for this identity', p_record_id USING ERRCODE = 'LD005';
  END IF;
END $$;

-- Access: RLS on, default deny. The API reads only its own records in the current org, and writes only through
-- claim_idempotency() / complete_idempotency() (no INSERT, UPDATE or DELETE grant).
ALTER TABLE design_os.idempotency_record ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_records ON design_os.idempotency_record FOR SELECT TO design_os_api
  USING (org_id = design_os.current_org_id() AND actor_user_id = design_os.current_user_id());
REVOKE ALL ON design_os.idempotency_record FROM PUBLIC;
GRANT SELECT ON design_os.idempotency_record TO design_os_api;
REVOKE ALL ON FUNCTION design_os.guard_idempotency_record(), design_os.check_idempotency_completed(),
  design_os.claim_idempotency(text, text, text, interval), design_os.complete_idempotency(uuid, smallint, jsonb, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION design_os.claim_idempotency(text, text, text, interval), design_os.complete_idempotency(uuid, smallint, jsonb, text, uuid) TO design_os_api;

-- Supabase REST roles get nothing (the schema is not exposed to PostgREST; see 0011).
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON design_os.idempotency_record FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION design_os.current_memberships(), design_os.claim_idempotency(text, text, text, interval), design_os.complete_idempotency(uuid, smallint, jsonb, text, uuid) FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- Operational records are not audited: the operation they protect is (its own rows are hash-chained in audit_log).
CREATE OR REPLACE FUNCTION design_os.unaudited_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT ARRAY['audit_log', 'versioned_table', 'role', 'permission', 'default_role_permission', 'construction_variable', 'planning_variable', 'manufacturing_variable', 'error_code', 'idempotency_record'] $$;
