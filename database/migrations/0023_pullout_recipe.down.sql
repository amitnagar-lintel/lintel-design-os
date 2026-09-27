-- Rollback of 0023 pull-out recipe. Fails if a construction standard already carries a value for one of the
-- three removed variable codes — that data loss is exactly what a foreign-key rollback should refuse, not
-- silently discard.
SET LOCAL ROLE design_os_owner;

DELETE FROM design_os.construction_variable WHERE code IN ('PULLOUT_FRAME_HEIGHT', 'PULLOUT_FRAME_SIDE_CLEARANCE', 'PULLOUT_FRAME_DEPTH_SETBACK');
