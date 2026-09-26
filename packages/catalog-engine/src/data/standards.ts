import type { ConstructionStandard } from "@lintel/types";

/**
 * Lintel's production construction standard — NOT YET DEFINED.
 *
 * Every value is `null` on purpose: the PRD and CLAUDE.md forbid inventing
 * construction dimensions. The engine reports each undefined value a recipe needs
 * as a BLOCKER. Lintel production must supply and approve these values.
 */
export const LINTEL_CONSTRUCTION_STANDARD_DRAFT: ConstructionStandard = {
  standardId: "LINTEL_CONSTRUCTION_STANDARD",
  version: "0.1.0",
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
  },
  // Edge rules not yet defined for any component type.
  edgeRuleSets: { CARCASS_STANDARD: {} },
};
