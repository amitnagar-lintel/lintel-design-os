-- 0001 down: remove the design_os schema foundation. Roles are cluster-wide and kept if still in use elsewhere.
SET LOCAL ROLE design_os_owner;
DROP FUNCTION design_os.install_insert_only(regclass);
DROP FUNCTION design_os.install_draft_guard(regclass, regclass, text);
DROP FUNCTION design_os.install_version_envelope(text, regclass, regclass, text, text);
DROP TABLE design_os.versioned_table;
DROP FUNCTION design_os.guard_draft_content();
DROP FUNCTION design_os.guard_version_row();
DROP FUNCTION design_os.lifecycle_columns();
DROP FUNCTION design_os.forbid_mutation();
DROP FUNCTION design_os.current_user_id();
DROP FUNCTION design_os.claims();
DROP TYPE design_os.snapshot_kind;
DROP TYPE design_os.identity_kind;
DROP TYPE design_os.design_os_role;
DROP TYPE design_os.record_lifecycle_status;
RESET ROLE;
DROP SCHEMA design_os;
