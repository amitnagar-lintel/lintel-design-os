-- 0010 down
SET LOCAL ROLE design_os_owner;
DO $$
DECLARE
  p record;
  t text;
BEGIN
  FOR p IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'design_os' LOOP
    EXECUTE format('DROP POLICY %I ON design_os.%I', p.policyname, p.tablename);
  END LOOP;
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'design_os' LOOP
    EXECUTE format('ALTER TABLE design_os.%I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
DROP FUNCTION design_os.client_can_read_file(uuid);
DROP FUNCTION design_os.is_issued(text, uuid);
DROP FUNCTION design_os.room_project(uuid);
DROP FUNCTION design_os.design_version_project(uuid);
