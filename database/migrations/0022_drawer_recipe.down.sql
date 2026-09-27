-- Rollback of 0022 drawer recipe. Fails if a RUNNER rule (NULL mounting columns) already exists, or if a
-- construction standard already carries a value for one of the three removed variable codes — that data loss
-- is exactly what a NOT NULL / foreign-key rollback should refuse, not silently discard.
SET LOCAL ROLE design_os_owner;

ALTER TABLE design_os.hettich_calculation_rule DROP CONSTRAINT hettich_calculation_rule_category_check;
ALTER TABLE design_os.hettich_calculation_rule ADD CONSTRAINT hettich_calculation_rule_category_check CHECK (category IN ('HINGE', 'MOUNTING_PLATE'));

ALTER TABLE design_os.hettich_article DROP CONSTRAINT hettich_article_category_check;
ALTER TABLE design_os.hettich_article ADD CONSTRAINT hettich_article_category_check CHECK (category IN ('HINGE', 'MOUNTING_PLATE'));

DELETE FROM design_os.construction_variable WHERE code IN ('DRAWER_BOX_SIDE_CLEARANCE', 'DRAWER_BOX_HEIGHT_GAP', 'DRAWER_BOX_FRONT_SETBACK');

ALTER TABLE design_os.hardware_rule ALTER COLUMN mounting_parameter_key SET NOT NULL;
ALTER TABLE design_os.hardware_rule ALTER COLUMN mounting_map SET NOT NULL;
