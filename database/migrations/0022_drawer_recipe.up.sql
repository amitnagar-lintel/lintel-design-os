-- 0022 drawer recipe (Design Studio Slice 2, KITCHEN_BASE_DRAWER_V1):
--  * A RunnerHardwareRule (PRD §28, drawer runners) has no mounting mode to map — a drawer is not hinged, so
--    there is nothing to select the equivalent of `mounting_parameter_key` / `mounting_map` for. Both columns
--    become nullable; a HINGED_DOOR row still always supplies both (enforced by @lintel/persistence's mapper,
--    not the database, exactly like every other cross-field rule in this schema).
--  * Three new construction variables the drawer recipe needs, registered exactly like 0003's shutter-recipe
--    ones (schema only: units and descriptions, no values — those stay NULL / UNVERIFIED until an organization
--    supplies and approves them).
--  * 0005's `hettich_article` / `hettich_calculation_rule` category CHECKs allowed only ('HINGE',
--    'MOUNTING_PLATE'); a drawer runner article/rule needs 'RUNNER' too.
SET LOCAL ROLE design_os_owner;

ALTER TABLE design_os.hardware_rule ALTER COLUMN mounting_parameter_key DROP NOT NULL;
ALTER TABLE design_os.hardware_rule ALTER COLUMN mounting_map DROP NOT NULL;

INSERT INTO design_os.construction_variable (code, unit, description) VALUES
  ('DRAWER_BOX_SIDE_CLEARANCE', 'MM', 'Total width clearance of the drawer box between the internal sides (runner mechanism clearance)'),
  ('DRAWER_BOX_HEIGHT_GAP', 'MM', 'Vertical clearance between a drawer''s front height and its own box height'),
  ('DRAWER_BOX_FRONT_SETBACK', 'MM', 'Drawer box front-wall setback from the carcass front face');

ALTER TABLE design_os.hettich_article DROP CONSTRAINT hettich_article_category_check;
ALTER TABLE design_os.hettich_article ADD CONSTRAINT hettich_article_category_check CHECK (category IN ('HINGE', 'MOUNTING_PLATE', 'RUNNER'));

ALTER TABLE design_os.hettich_calculation_rule DROP CONSTRAINT hettich_calculation_rule_category_check;
ALTER TABLE design_os.hettich_calculation_rule ADD CONSTRAINT hettich_calculation_rule_category_check CHECK (category IN ('HINGE', 'MOUNTING_PLATE', 'RUNNER'));
