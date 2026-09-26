-- 0020 readiness and audit read (M6 G7). Grants and two read-only SQL wrappers; no table, no trigger, no PL/pgSQL.
--
-- 1. The API role may READ the migration ledger (version, name, checksum, applied_at), so /ready and /readiness can
--    compare the database with the migrations the running build ships. It can never write it.
-- 2. design_os.audit_chain_status(): the existing hash-chain verification, for the caller's own organization only,
--    and only with audit.read.
-- 3. design_os.reference_approval_problems(type, id): the existing approval preconditions (dependencies APPROVED /
--    LOCKED, completeness, source verification) of a reference-data version of the caller's own organization, with
--    reference.read — so readiness reports exactly what the database would refuse, without a second rule set.

-- As the migration user, who owns the ledger (the runner creates it before the first migration).
GRANT USAGE ON SCHEMA design_os_migrations TO design_os_api;
GRANT SELECT ON design_os_migrations.applied TO design_os_api;

SET LOCAL ROLE design_os_owner;

CREATE FUNCTION design_os.audit_chain_status() RETURNS TABLE (ok boolean, checked bigint, first_bad_id bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
    SELECT v.ok, v.checked, v.first_bad_id FROM design_os.verify_audit_chain(design_os.current_org_id()) v
    WHERE design_os.current_org_id() IS NOT NULL AND design_os.is_internal() AND design_os.has_permission('audit.read')
  $$;

CREATE FUNCTION design_os.reference_approval_problems(p_subject_type text, p_id uuid) RETURNS TABLE (problem_code text, problem_message text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
    SELECT i.problem_code, i.problem_message FROM design_os.approval_problem_items(p_subject_type, p_id, design_os.current_org_id()) i
    WHERE p_subject_type <> 'design' AND design_os.current_org_id() IS NOT NULL AND design_os.is_internal() AND design_os.has_permission('reference.read')
  $$;

REVOKE ALL ON FUNCTION design_os.audit_chain_status(), design_os.reference_approval_problems(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION design_os.audit_chain_status(), design_os.reference_approval_problems(text, uuid) TO design_os_api;
