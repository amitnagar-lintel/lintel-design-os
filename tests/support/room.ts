import type { DesignObject, ManufacturerAdapter, ParameterValue, PlanningStandard, RelationshipOverride, ResolvedRoom, Room, Transform } from "@lintel/types";
import { LINTEL_CATALOG, LINTEL_CONSTRUCTION_STANDARD_DRAFT, LINTEL_PLANNING_STANDARD_DRAFT, TEST_FIXTURE_CONSTRUCTION_STANDARD, TEST_FIXTURE_PLANNING_STANDARD } from "@lintel/catalog-engine";
import { createHettichAdapter, HETTICH_PRODUCTION_DATASET, HETTICH_TEST_FIXTURE_DATASET } from "@lintel/hettich-engine";
import { resolveRoom } from "@lintel/design-engine";
import { DESIGN_VERSION } from "./scenario.js";

/** PRD §11 kitchen: 4200 (along wall A) × 3200 × 3000, 150 mm walls. */
export const KITCHEN: Room = { id: "room_001", projectId: "project_001", name: "Kitchen", type: "KITCHEN", length: 4200, width: 3200, height: 3000, wallThickness: 150 };

export function cabinet(code: string, width: number, t: Partial<Transform>, parameters: Record<string, ParameterValue> = {}): DesignObject {
  return {
    objectId: `obj_${code.slice(-3)}`,
    objectCode: code,
    projectId: "project_001",
    roomId: "room_001",
    objectType: "BASE_CABINET",
    productId: "KIT_BASE_STANDARD",
    transform: { x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, ...t },
    dimensions: { width, height: 720, depth: 560 },
    parameters: { carcassThickness: 18, backThickness: 6, shelfCount: 1, shutterCount: 2, frontType: "OVERLAY", material: "BOARD_BWP_18", finish: "LAMINATE_WHITE", ...parameters },
    status: "DRAFT",
  };
}

/**
 * L-shaped reference layout (TEST_FIXTURE):
 *   wall A: OBJ-KIT-001 (600) at x=0, OBJ-KIT-002 (750) at x=600, OBJ-KIT-003 (600) at x=1350 — touching;
 *   wall D: OBJ-KIT-004 (600, rotated 90°), back on wall D, spanning z 600…1200 (clear of 001's fronts).
 * For rotationY = 90 the cabinet's local origin maps to (x, z) and local +X runs towards −Z.
 */
export function lLayout(): DesignObject[] {
  return [
    cabinet("OBJ-KIT-001", 600, { x: 0, z: 0 }),
    cabinet("OBJ-KIT-002", 750, { x: 600, z: 0 }),
    cabinet("OBJ-KIT-003", 600, { x: 1350, z: 0 }),
    cabinet("OBJ-KIT-004", 600, { x: 0, z: 1200, rotationY: 90 }),
  ];
}

export function fixtureRoom(objects: readonly DesignObject[] = lLayout(), opts: { overrides?: RelationshipOverride[]; planning?: PlanningStandard; adapters?: ManufacturerAdapter[] } = {}): ResolvedRoom {
  return resolveRoom({
    designVersion: DESIGN_VERSION,
    room: KITCHEN,
    objects,
    catalog: LINTEL_CATALOG,
    standard: TEST_FIXTURE_CONSTRUCTION_STANDARD,
    planning: opts.planning ?? TEST_FIXTURE_PLANNING_STANDARD,
    adapters: opts.adapters ?? [createHettichAdapter(HETTICH_TEST_FIXTURE_DATASET)],
    ...(opts.overrides === undefined ? {} : { overrides: opts.overrides }),
  });
}

export function productionRoom(objects: readonly DesignObject[] = lLayout()): ResolvedRoom {
  return resolveRoom({
    designVersion: DESIGN_VERSION,
    room: KITCHEN,
    objects,
    catalog: LINTEL_CATALOG,
    standard: LINTEL_CONSTRUCTION_STANDARD_DRAFT,
    planning: LINTEL_PLANNING_STANDARD_DRAFT,
    adapters: [createHettichAdapter(HETTICH_PRODUCTION_DATASET)],
  });
}
