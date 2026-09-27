-- Rollback of 0024 oven tower recipe. Fails if a construction standard already carries a value for the
-- removed variable code — that data loss is exactly what a foreign-key rollback should refuse, not silently
-- discard.
SET LOCAL ROLE design_os_owner;

DELETE FROM design_os.construction_variable WHERE code = 'OVEN_BAY_BOTTOM_OFFSET';
