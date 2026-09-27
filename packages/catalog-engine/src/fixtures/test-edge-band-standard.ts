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
    // KITCHEN_BASE_DRAWER_V1's own rule set (a recipe's edgeRuleSetId names one whole set; the shared
    // carcass component types are repeated here rather than split across two rule sets).
    DRAWER_CARCASS_STANDARD: {
      SIDE_LEFT: { FRONT: "EDGE_ABS_0_8MM" },
      SIDE_RIGHT: { FRONT: "EDGE_ABS_0_8MM" },
      BOTTOM: { FRONT: "EDGE_ABS_0_8MM" },
      TOP_SUPPORT_FRONT: { FRONT: "EDGE_ABS_0_8MM" },
      TOP_SUPPORT_BACK: {},
      BACK: {},
      DRAWER_FRONT: { TOP: "EDGE_ABS_2MM", BOTTOM: "EDGE_ABS_2MM", LEFT: "EDGE_ABS_2MM", RIGHT: "EDGE_ABS_2MM" },
      DRAWER_BOX_SIDE: { TOP: "EDGE_ABS_0_8MM" },
      DRAWER_BOX_BACK: {},
      DRAWER_BOTTOM: {},
    },
    // KITCHEN_BASE_OPEN_V1's own rule set: the shared carcass/shelf component types only, no SHUTTER (there
    // is no front to edge-band).
    OPEN_CARCASS_STANDARD: {
      SIDE_LEFT: { FRONT: "EDGE_ABS_0_8MM" },
      SIDE_RIGHT: { FRONT: "EDGE_ABS_0_8MM" },
      BOTTOM: { FRONT: "EDGE_ABS_0_8MM" },
      TOP_SUPPORT_FRONT: { FRONT: "EDGE_ABS_0_8MM" },
      TOP_SUPPORT_BACK: {},
      BACK: {},
      SHELF: { FRONT: "EDGE_ABS_0_8MM" },
    },
    // KITCHEN_BASE_PULLOUT_V1's own rule set: the shared carcass types, SHUTTER (same as CARCASS_STANDARD),
    // and the internal pull-out frame/tray (unbanded, same precedent as DRAWER_BOX_SIDE/DRAWER_BOTTOM: never
    // a visible edge).
    PULLOUT_CARCASS_STANDARD: {
      SIDE_LEFT: { FRONT: "EDGE_ABS_0_8MM" },
      SIDE_RIGHT: { FRONT: "EDGE_ABS_0_8MM" },
      BOTTOM: { FRONT: "EDGE_ABS_0_8MM" },
      TOP_SUPPORT_FRONT: { FRONT: "EDGE_ABS_0_8MM" },
      TOP_SUPPORT_BACK: {},
      BACK: {},
      SHUTTER: { TOP: "EDGE_ABS_2MM", BOTTOM: "EDGE_ABS_2MM", LEFT: "EDGE_ABS_2MM", RIGHT: "EDGE_ABS_2MM" },
      PULLOUT_FRAME_SIDE: { TOP: "EDGE_ABS_0_8MM" },
      PULLOUT_TRAY: {},
    },
    // KITCHEN_TALL_OVEN_V1's own rule set: the shared carcass/shelf component types only, no SHUTTER (no front
    // this slice — the appliance bay sits behind whatever front a later slice adds).
    OVEN_TOWER_CARCASS_STANDARD: {
      SIDE_LEFT: { FRONT: "EDGE_ABS_0_8MM" },
      SIDE_RIGHT: { FRONT: "EDGE_ABS_0_8MM" },
      BOTTOM: { FRONT: "EDGE_ABS_0_8MM" },
      TOP_SUPPORT_FRONT: { FRONT: "EDGE_ABS_0_8MM" },
      TOP_SUPPORT_BACK: {},
      BACK: {},
      SHELF: { FRONT: "EDGE_ABS_0_8MM" },
    },
    // KITCHEN_BASE_SINK_V1's own rule set: the shared carcass component types (no TOP_SUPPORT_BACK — this
    // recipe never generates one), SHUTTER (same as CARCASS_STANDARD), and the internal waste-bin frame/tray
    // (unbanded, same precedent as PULLOUT_CARCASS_STANDARD's own entries: never a visible edge).
    SINK_CARCASS_STANDARD: {
      SIDE_LEFT: { FRONT: "EDGE_ABS_0_8MM" },
      SIDE_RIGHT: { FRONT: "EDGE_ABS_0_8MM" },
      BOTTOM: { FRONT: "EDGE_ABS_0_8MM" },
      TOP_SUPPORT_FRONT: { FRONT: "EDGE_ABS_0_8MM" },
      BACK: {},
      SHUTTER: { TOP: "EDGE_ABS_2MM", BOTTOM: "EDGE_ABS_2MM", LEFT: "EDGE_ABS_2MM", RIGHT: "EDGE_ABS_2MM" },
      PULLOUT_FRAME_SIDE: { TOP: "EDGE_ABS_0_8MM" },
      PULLOUT_TRAY: {},
    },
  },
};
