-- 0005 down
SET LOCAL ROLE design_os_owner;
DROP TABLE design_os.hettich_calculation_rule;
DROP TABLE design_os.hettich_article;
DROP TABLE design_os.hettich_dataset_version;
DELETE FROM design_os.versioned_table WHERE subject_type = 'hettich_dataset';
DROP TABLE design_os.hettich_dataset;
