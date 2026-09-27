-- 0023 pull-out recipe (Design Studio Slice 5 step 1, KITCHEN_BASE_PULLOUT_V1):
--  * Three new construction variables the pull-out recipe needs, registered exactly like 0003's shutter-recipe
--    and 0022's drawer-recipe ones (schema only: units and descriptions, no values — those stay NULL /
--    UNVERIFIED until an organization supplies and approves them).
--  * No hardware_rule / hettich_article / hettich_calculation_rule change: the pull-out frame reuses the
--    existing RUNNER category and nullable hinge-mounting columns 0022 already added.
SET LOCAL ROLE design_os_owner;

INSERT INTO design_os.construction_variable (code, unit, description) VALUES
  ('PULLOUT_FRAME_HEIGHT', 'MM', 'Height of a pull-out frame''s side panel (occupied height per pull-out slot)'),
  ('PULLOUT_FRAME_SIDE_CLEARANCE', 'MM', 'Total width clearance of a pull-out frame between the internal sides (runner mechanism clearance)'),
  ('PULLOUT_FRAME_DEPTH_SETBACK', 'MM', 'Pull-out frame front-wall setback from the carcass front face');
