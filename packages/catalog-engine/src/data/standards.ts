import type { ConstructionStandard, EdgeBandStandard } from "@lintel/types";

/**
 * Lintel's production construction standard — NOT YET DEFINED.
 *
 * Every value is `null` on purpose: the PRD and CLAUDE.md forbid inventing
 * construction dimensions. The engine reports each undefined value a recipe needs
 * as a BLOCKER. Lintel production must supply and approve these values.
 */
export const LINTEL_CONSTRUCTION_STANDARD_DRAFT: ConstructionStandard = {
  standardId: "LINTEL_CONSTRUCTION_STANDARD",
  version: "0.2.0",
  status: "DRAFT",
  description: "Lintel Space Atelier construction standard (to be defined by production).",
  source: "Pending — Lintel production team",
  variables: {
    BACK_GROOVE_DEPTH: null,
    BACK_REAR_OFFSET: null,
    TOP_RAIL_WIDTH: null,
    SHELF_FRONT_SETBACK: null,
    SHELF_SIDE_CLEARANCE: null,
    OVERLAY_EDGE_GAP: null,
    OVERLAY_TOP_GAP: null,
    OVERLAY_BOTTOM_GAP: null,
    FRONT_BETWEEN_GAP: null,
    INSET_GAP: null,
    FRONT_FINISHED_FACES: null,
    SHUTTER_BACK_GAP: null,
    DRAWER_BOX_SIDE_CLEARANCE: null,
    DRAWER_BOX_HEIGHT_GAP: null,
    DRAWER_BOX_FRONT_SETBACK: null,
    PULLOUT_FRAME_HEIGHT: null,
    PULLOUT_FRAME_SIDE_CLEARANCE: null,
    PULLOUT_FRAME_DEPTH_SETBACK: null,
    OVEN_BAY_BOTTOM_OFFSET: null,
  },
};

/**
 * Lintel's production edge-band standard — NOT YET DEFINED.
 *
 * Separate from the construction standard. No component type has edge rules yet, so the
 * engine reports each one it needs as a BLOCKER. Lintel production must supply and approve them.
 */
export const LINTEL_EDGE_BAND_STANDARD_DRAFT: EdgeBandStandard = {
  standardId: "LINTEL_EDGE_BAND_STANDARD",
  version: "0.1.0",
  status: "DRAFT",
  description: "Lintel Space Atelier edge-band standard (to be defined by production).",
  source: "Pending — Lintel production team",
  // Edge rules not yet defined for any component type.
  ruleSets: { CARCASS_STANDARD: {}, DRAWER_CARCASS_STANDARD: {}, OPEN_CARCASS_STANDARD: {}, PULLOUT_CARCASS_STANDARD: {}, OVEN_TOWER_CARCASS_STANDARD: {}, SINK_CARCASS_STANDARD: {}, HOB_CARCASS_STANDARD: {}, FILLER_CARCASS_STANDARD: {}, END_PANEL_CARCASS_STANDARD: {} },
};
