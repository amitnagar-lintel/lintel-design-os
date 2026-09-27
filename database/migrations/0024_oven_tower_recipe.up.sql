-- 0024 oven tower recipe (Design Studio Slice 5 step 3, KITCHEN_TALL_OVEN_V1):
--  * One new construction variable the oven tower recipe needs, registered exactly like 0022's drawer-recipe
--    and 0023's pull-out-recipe ones (schema only: unit and description, no value — stays NULL / UNVERIFIED
--    until an organization supplies and approves it).
--  * No hardware_rule / hettich_article / hettich_calculation_rule change: the appliance bay has no hardware
--    of its own this slice (OVEN_TOWER_STANDARD carries zero rules).
SET LOCAL ROLE design_os_owner;

INSERT INTO design_os.construction_variable (code, unit, description) VALUES
  ('OVEN_BAY_BOTTOM_OFFSET', 'MM', 'Height from the carcass floor to the bottom of the built-in oven''s appliance bay');
