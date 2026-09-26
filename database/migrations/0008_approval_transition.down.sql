-- 0008 down
SET LOCAL ROLE design_os_owner;
DROP FUNCTION design_os.transition(text, uuid, text, text, text);
DROP FUNCTION design_os.lock_cascade(text, uuid, uuid, uuid, text);
DROP FUNCTION design_os.record_decision(uuid, text, uuid, text, uuid, text, design_os.record_lifecycle_status, design_os.record_lifecycle_status, text, uuid);
DROP FUNCTION design_os.approval_problems(text, uuid, uuid);
DROP FUNCTION design_os.is_official_hettich_url(text);
DROP FUNCTION design_os.version_dependencies(text, uuid, uuid);
DROP FUNCTION design_os.version_status(text, uuid, uuid);
DROP TABLE design_os.approval_decision;
DROP TABLE design_os.approval_request;
