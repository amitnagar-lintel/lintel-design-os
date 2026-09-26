import type { PlanningStandard } from "@lintel/types";

export interface PlanningVariableDefinition {
  readonly key: string;
  readonly description: string;
  readonly unit: "MM";
}

/**
 * Planning variables (how objects may be positioned in a room). Separate from the
 * ConstructionStandard (how a cabinet is built). Semantics below are the engine's
 * definitions and must be confirmed by Lintel when values are supplied.
 */
export const PLANNING_VARIABLES: readonly PlanningVariableDefinition[] = [
  { key: "MIN_WALL_CLEARANCE", description: "Minimum distance between the end of a run and the perpendicular wall it runs towards", unit: "MM" },
  { key: "MIN_CABINET_GAP", description: "Smallest non-zero gap permitted between two adjacent objects in a run (0 = touching is always allowed)", unit: "MM" },
  { key: "MAX_GAP_WITHOUT_FILLER", description: "Largest gap between two adjacent objects that is permitted without a filler", unit: "MM" },
  { key: "FILLER_THRESHOLD", description: "Smallest gap that a filler can close (narrowest manufacturable filler); gaps that need a filler but are narrower are unfillable", unit: "MM" },
  { key: "MAX_RUN_LENGTH", description: "Maximum length of one same-wall run of objects", unit: "MM" },
  { key: "SERVICE_VOID_REAR", description: "Required service clearance: minimum distance between an object's back and the wall it faces", unit: "MM" },
];

/**
 * Lintel planning standard — NOT YET DEFINED. Every value is NULL / UNVERIFIED; any
 * placement check that needs one reports PLANNING_VALUE_UNDEFINED (BLOCKER).
 */
export const LINTEL_PLANNING_STANDARD_DRAFT: PlanningStandard = {
  standardId: "LINTEL_PLANNING_STANDARD",
  version: "0.1.0",
  status: "DRAFT",
  description: "Lintel Space Atelier room planning standard (to be defined by design and production).",
  source: "Pending — Lintel design / production",
  variables: {
    MIN_WALL_CLEARANCE: null,
    MIN_CABINET_GAP: null,
    MAX_GAP_WITHOUT_FILLER: null,
    FILLER_THRESHOLD: null,
    MAX_RUN_LENGTH: null,
    SERVICE_VOID_REAR: null,
  },
};
