-- 0006 down
SET LOCAL ROLE design_os_owner;
DROP TABLE design_os.validation_run;
DROP TABLE design_os.relationship_override;
DROP TABLE design_os.design_object;
DROP FUNCTION design_os.guard_design_object_product();
DROP TABLE design_os.design_version;
DROP FUNCTION design_os.guard_design_version_room();
DELETE FROM design_os.versioned_table WHERE subject_type = 'design';
DROP TABLE design_os.design;
DROP TABLE design_os.room_revision;
DROP TABLE design_os.room;
