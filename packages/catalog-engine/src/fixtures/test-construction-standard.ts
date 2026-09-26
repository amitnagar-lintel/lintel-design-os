import type { ConstructionStandard } from "@lintel/types";

/**
 * TEST FIXTURE — synthetic values used only to exercise engine mechanics in tests
 * and golden fixtures. These are NOT Lintel's construction values and NOT
 * manufacturer data. Status TEST_FIXTURE is never approvable: the design engine
 * always emits a BLOCKER when this standard is used.
 */
export const TEST_FIXTURE_CONSTRUCTION_STANDARD: ConstructionStandard = {
  standardId: "TEST_FIXTURE_CONSTRUCTION_STANDARD",
  version: "0.0.2",
  status: "TEST_FIXTURE",
  description: "Synthetic construction values for engine tests only. Not for production.",
  source: "Test fixture (synthetic)",
  variables: {
    BACK_GROOVE_DEPTH: 8,
    BACK_REAR_OFFSET: 16,
    TOP_RAIL_WIDTH: 100,
    SHELF_FRONT_SETBACK: 20,
    SHELF_SIDE_CLEARANCE: 2,
    OVERLAY_EDGE_GAP: 1.5,
    OVERLAY_TOP_GAP: 3,
    OVERLAY_BOTTOM_GAP: 0,
    FRONT_BETWEEN_GAP: 3,
    INSET_GAP: 2,
    FRONT_FINISHED_FACES: 2,
    // Synthetic; deliberately different from the 2 mm industry benchmark so it cannot be mistaken for it.
    SHUTTER_BACK_GAP: 1,
  },
};
