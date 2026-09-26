-- 0009 down
SET LOCAL ROLE design_os_owner;
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'design_os' AND tablename <> ALL (design_os.unaudited_tables()) ORDER BY tablename LOOP
    EXECUTE format('DROP TRIGGER audit_row ON design_os.%I', t);
  END LOOP;
END $$;
DROP FUNCTION design_os.unaudited_tables();
DROP FUNCTION design_os.verify_audit_chain(uuid);
DROP TABLE design_os.audit_log;
DROP FUNCTION design_os.forbid_truncate();
DROP FUNCTION design_os.audit_row();
DROP FUNCTION design_os.audit_chain_hash(text, text);
DROP FUNCTION design_os.audit_canonical(uuid, timestamptz, uuid, text, text, text, jsonb, jsonb, text, text);
