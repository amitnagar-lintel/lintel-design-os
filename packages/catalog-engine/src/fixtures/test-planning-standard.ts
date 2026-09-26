import type { PlanningStandard } from "@lintel/types";

/**
 * TEST FIXTURE — synthetic planning values for engine tests only. NOT Lintel planning
 * rules. Status TEST_FIXTURE is never approvable and marks every result TEST_FIXTURE.
 */
export const TEST_FIXTURE_PLANNING_STANDARD: PlanningStandard = {
  standardId: "TEST_FIXTURE_PLANNING_STANDARD",
  version: "0.0.1",
  status: "TEST_FIXTURE",
  description: "Synthetic planning values for engine tests only. Not for production.",
  source: "Test fixture (synthetic)",
  variables: {
    MIN_WALL_CLEARANCE: 0,
    MIN_CABINET_GAP: 3,
    MAX_GAP_WITHOUT_FILLER: 10,
    FILLER_THRESHOLD: 25,
    MAX_RUN_LENGTH: 3600,
    SERVICE_VOID_REAR: 0,
  },
};
