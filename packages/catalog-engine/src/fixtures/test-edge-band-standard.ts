import type { EdgeBandStandard } from "@lintel/types";

/**
 * TEST FIXTURE — synthetic edge rules used only to exercise engine mechanics in tests
 * and golden fixtures. These are NOT Lintel's edge-banding rules. Status TEST_FIXTURE is
 * never approvable: the design engine always emits a BLOCKER when this standard is used.
 */
export const TEST_FIXTURE_EDGE_BAND_STANDARD: EdgeBandStandard = {
  standardId: "TEST_FIXTURE_EDGE_BAND_STANDARD",
  version: "0.0.1",
  status: "TEST_FIXTURE",
  description: "Synthetic edge rules for engine tests only. Not for production.",
  source: "Test fixture (synthetic)",
  ruleSets: {
    CARCASS_STANDARD: {
      SIDE_LEFT: { FRONT: "EDGE_ABS_0_8MM" },
      SIDE_RIGHT: { FRONT: "EDGE_ABS_0_8MM" },
      BOTTOM: { FRONT: "EDGE_ABS_0_8MM" },
      TOP_SUPPORT_FRONT: { FRONT: "EDGE_ABS_0_8MM" },
      TOP_SUPPORT_BACK: {},
      BACK: {},
      SHELF: { FRONT: "EDGE_ABS_0_8MM" },
      SHUTTER: { TOP: "EDGE_ABS_2MM", BOTTOM: "EDGE_ABS_2MM", LEFT: "EDGE_ABS_2MM", RIGHT: "EDGE_ABS_2MM" },
    },
  },
};
