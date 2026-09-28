/** M4 commit 1 — room model, placement and validation (TEST_FIXTURE data). */
import { describe, expect, it } from "vitest";
import type { PlanningStandard, RelationshipOverride, ResolvedRoom } from "@lintel/types";
import { TEST_FIXTURE_PLANNING_STANDARD } from "@lintel/catalog-engine";
import { cabinet, fixtureRoom, lLayout, productionRoom } from "./support/room.js";

const roomCodes = (r: ResolvedRoom): string[] => r.validation.messages.filter((m) => m.path?.startsWith("rooms.") === true || m.path?.startsWith("planning") === true).map((m) => m.code);
const rel = (r: ResolvedRoom, id: string) => r.relationships.find((x) => x.relationshipId === id);
const withPlanning = (vars: Record<string, number | null>): PlanningStandard => ({ ...TEST_FIXTURE_PLANNING_STANDARD, variables: { ...TEST_FIXTURE_PLANNING_STANDARD.variables, ...vars } });

describe("L-shaped reference layout", () => {
  const r = fixtureRoom();
  it("places every cabinet in room coordinates", () => {
    expect(r.placements.map((p) => [p.objectCode, p.wallId, p.rotationY, p.alongWall.start, p.alongWall.end, p.distanceToWall])).toEqual([
      ["OBJ-KIT-001", "A", 0, 0, 600, 0],
      ["OBJ-KIT-002", "A", 0, 600, 1350, 0],
      ["OBJ-KIT-003", "A", 0, 1350, 1950, 0],
      ["OBJ-KIT-004", "D", 90, 2000, 2600, 0],
    ]);
    expect(r.placements[3]?.envelope).toEqual({ min: { x: 0, y: 0, z: 600 }, size: { x: 579, y: 720, z: 600 } });
  });
  it("derives runs, adjacency, wall and corner relationships from geometry", () => {
    expect(r.runs.map((x) => [x.runId, x.objectIds, x.start, x.end, x.length])).toEqual([
      ["RUN:A:1", ["obj_001", "obj_002", "obj_003"], 0, 1950, 1950],
      ["RUN:D:1", ["obj_004"], 2000, 2600, 600],
    ]);
    expect(rel(r, "REL:ADJ:obj_001:obj_002")).toMatchObject({ type: "ADJACENT", gap: 0, touching: true, source: "DERIVED" });
    expect(rel(r, "REL:WALL:obj_004")).toMatchObject({ type: "AGAINST_WALL", wallIds: ["D"], gap: 0, touching: true });
    expect(rel(r, "REL:CORNER:DA")).toMatchObject({ type: "CORNER", objectIds: ["obj_004", "obj_001"], gap: 21, touching: false });
  });
  it("has no collision, containment or planning violations", () => {
    expect(roomCodes(r).filter((c) => !["PLANNING_STANDARD_NOT_APPROVED", "TEST_FIXTURE_DATA_IN_USE"].includes(c))).toEqual([]);
    expect(r.trace.dataClassification).toBe("TEST_FIXTURE");
    expect(r.validation.canApprove).toBe(false);
  });
  it("traces every object fingerprint and is order-independent", () => {
    expect(r.trace.objects.map((o) => o.objectCode)).toEqual(["OBJ-KIT-001", "OBJ-KIT-002", "OBJ-KIT-003", "OBJ-KIT-004"]);
    const shuffled = fixtureRoom([...lLayout()].reverse());
    expect(shuffled).toEqual(r);
  });
  it("changes the room fingerprint when any object changes", () => {
    const changed = lLayout().map((o) => (o.objectCode === "OBJ-KIT-003" ? cabinet("OBJ-KIT-003", 600, { x: 1350 }, { shutterCount: 1 }) : o));
    const r2 = fixtureRoom(changed);
    expect(r2.roomFingerprint).not.toBe(r.roomFingerprint);
    expect(r2.trace.objects.filter((o, i) => o.modelFingerprint !== r.trace.objects[i]?.modelFingerprint).map((o) => o.objectCode)).toEqual(["OBJ-KIT-003"]);
  });
});

describe("collision and containment", () => {
  it("detects overlapping cabinets (exact, component level)", () => {
    const r = fixtureRoom([cabinet("OBJ-KIT-001", 600, { x: 0 }), cabinet("OBJ-KIT-002", 750, { x: 550 })]);
    const m = r.validation.messages.find((x) => x.code === "OBJECT_COLLISION");
    expect(m?.severity).toBe("BLOCKER");
    expect(m?.message).toMatch(/OBJ-KIT-001 collides with OBJ-KIT-002/);
  });
  it("allows touching and detects a front colliding with a returned cabinet at the corner", () => {
    expect(roomCodes(fixtureRoom([cabinet("OBJ-KIT-001", 600, { x: 0 }), cabinet("OBJ-KIT-002", 600, { x: 600 })]))).not.toContain("OBJECT_COLLISION");
    const tight = fixtureRoom([cabinet("OBJ-KIT-001", 600, { x: 0 }), cabinet("OBJ-KIT-004", 600, { x: 0, z: 1160, rotationY: 90 })]);
    expect(tight.validation.messages.find((m) => m.code === "OBJECT_COLLISION")?.details).toMatchObject({ componentA: "OBJ-KIT-001-SHT-L" });
  });
  it("detects a cabinet through a wall, below the floor and above the ceiling", () => {
    expect(roomCodes(fixtureRoom([cabinet("OBJ-KIT-003", 600, { x: 3700 })]))).toContain("OBJECT_THROUGH_WALL");
    expect(fixtureRoom([cabinet("OBJ-KIT-003", 600, { x: 3700 })]).validation.messages.find((m) => m.code === "OBJECT_THROUGH_WALL")?.message).toBe("OBJ-KIT-003 passes through wall B by up to 100 mm");
    expect(roomCodes(fixtureRoom([cabinet("OBJ-KIT-001", 600, { y: -10 })]))).toContain("OBJECT_BELOW_FLOOR");
    expect(roomCodes(fixtureRoom([cabinet("OBJ-KIT-001", 600, { y: 2400 })]))).toContain("OBJECT_ABOVE_CEILING");
  });
});

describe("rotation, identity and membership", () => {
  it("rejects non-quarter-turn rotation and does not place the object", () => {
    const r = fixtureRoom([cabinet("OBJ-KIT-001", 600, { rotationY: 45 })]);
    expect(roomCodes(r)).toContain("ROTATION_UNSUPPORTED");
    expect(r.placements).toEqual([]);
    expect(roomCodes(fixtureRoom([cabinet("OBJ-KIT-001", 600, { rotationX: 90 })]))).toContain("ROTATION_UNSUPPORTED");
  });
  it("places all four orientations against their walls", () => {
    const r = fixtureRoom([cabinet("OBJ-KIT-001", 600, { x: 1000, z: 0, rotationY: 0 }), cabinet("OBJ-KIT-002", 600, { x: 4200, z: 1000, rotationY: 270 }), cabinet("OBJ-KIT-003", 600, { x: 2000, z: 3200, rotationY: 180 }), cabinet("OBJ-KIT-004", 600, { x: 0, z: 2000, rotationY: 90 })]);
    expect(r.placements.map((p) => [p.objectCode, p.wallId, p.distanceToWall])).toEqual([
      ["OBJ-KIT-001", "A", 0],
      ["OBJ-KIT-002", "B", 0],
      ["OBJ-KIT-003", "C", 0],
      ["OBJ-KIT-004", "D", 0],
    ]);
    expect(roomCodes(r)).not.toContain("OBJECT_THROUGH_WALL");
  });
  it("reports duplicate ids / codes and objects from another room", () => {
    const dupId = { ...cabinet("OBJ-KIT-009", 600, { x: 1000 }), objectId: "obj_001" };
    expect(roomCodes(fixtureRoom([cabinet("OBJ-KIT-001", 600, {}), dupId]))).toContain("DUPLICATE_OBJECT_ID");
    expect(roomCodes(fixtureRoom([cabinet("OBJ-KIT-001", 600, {}), { ...cabinet("OBJ-KIT-001", 600, { x: 1000 }), objectId: "obj_x" }]))).toContain("DUPLICATE_OBJECT_CODE");
    expect(roomCodes(fixtureRoom([{ ...cabinet("OBJ-KIT-001", 600, {}), roomId: "room_999" }]))).toContain("OBJECT_ROOM_MISMATCH");
  });
});

describe("planning standard checks", () => {
  const gapLayout = (gap: number) => [cabinet("OBJ-KIT-001", 600, { x: 0 }), cabinet("OBJ-KIT-002", 600, { x: 600 + gap })];
  it("classifies gaps: touching OK, below minimum, within tolerance, unfillable, filler required", () => {
    expect(roomCodes(fixtureRoom(gapLayout(0))).filter((c) => c.startsWith("GAP") || c === "FILLER_REQUIRED")).toEqual([]);
    expect(roomCodes(fixtureRoom(gapLayout(2)))).toContain("GAP_BELOW_MINIMUM");
    expect(roomCodes(fixtureRoom(gapLayout(5))).filter((c) => c.startsWith("GAP") || c === "FILLER_REQUIRED")).toEqual([]);
    expect(roomCodes(fixtureRoom(gapLayout(20)))).toContain("GAP_UNFILLABLE");
    expect(roomCodes(fixtureRoom(gapLayout(40)))).toContain("FILLER_REQUIRED");
  });
  it("an audited INTENTIONAL_GAP override suppresses the gap check and marks the relationship", () => {
    const ov: RelationshipOverride = { overrideId: "OV-1", version: 1, type: "INTENTIONAL_GAP", objectIds: ["obj_001", "obj_002"], reason: "Dishwasher opening", author: "test designer", createdAt: "2026-09-26" };
    const r = fixtureRoom(gapLayout(40), { overrides: [ov] });
    expect(roomCodes(r)).not.toContain("FILLER_REQUIRED");
    expect(roomCodes(r)).toContain("OVERRIDE_APPLIED");
    expect(rel(r, "REL:ADJ:obj_001:obj_002")).toMatchObject({ source: "OVERRIDE", overrideIds: ["OV-1"], gap: 40 });
    expect(r.trace.overrides).toEqual([{ overrideId: "OV-1", version: 1 }]);
  });
  it("rejects unaudited or invalid overrides and records unsupported ones", () => {
    const bad: RelationshipOverride = { overrideId: "OV-2", version: 1, type: "INTENTIONAL_GAP", objectIds: ["obj_001", "obj_999"], reason: "", author: "", createdAt: "" };
    expect(roomCodes(fixtureRoom(gapLayout(40), { overrides: [bad] }))).toEqual(expect.arrayContaining(["OVERRIDE_INVALID", "FILLER_REQUIRED"]));
    const filler: RelationshipOverride = { overrideId: "OV-3", version: 1, type: "FILLER", objectIds: ["obj_001", "obj_002"], reason: "filler", author: "t", createdAt: "2026-09-26" };
    expect(roomCodes(fixtureRoom(gapLayout(0), { overrides: [filler] }))).toContain("OVERRIDE_NOT_YET_SUPPORTED");
  });
  it("checks run length, wall clearance and service void", () => {
    const seven = Array.from({ length: 7 }, (_, i) => cabinet(`OBJ-KIT-00${i + 1}`, 600, { x: i * 600 }));
    expect(roomCodes(fixtureRoom(seven))).toContain("RUN_TOO_LONG");
    expect(roomCodes(fixtureRoom([cabinet("OBJ-KIT-001", 600, { x: 10 })], { planning: withPlanning({ MIN_WALL_CLEARANCE: 20 }) }))).toContain("WALL_CLEARANCE_BELOW_MINIMUM");
    expect(roomCodes(fixtureRoom([cabinet("OBJ-KIT-001", 600, { z: 10 })], { planning: withPlanning({ SERVICE_VOID_REAR: 25 }) }))).toContain("SERVICE_VOID_BELOW_MINIMUM");
  });
  it("Slice 6E: warns CABINET_GAP_NOT_TOUCHING for a small near-miss gap, but never alongside a BLOCKER-level gap code for the same pair", () => {
    expect(roomCodes(fixtureRoom(gapLayout(0)))).not.toContain("CABINET_GAP_NOT_TOUCHING"); // touching: no warning
    expect(roomCodes(fixtureRoom(gapLayout(2)))).toEqual(expect.arrayContaining(["GAP_BELOW_MINIMUM"])); // below minimum: BLOCKER only, no WARNING piled on top
    expect(roomCodes(fixtureRoom(gapLayout(2)))).not.toContain("CABINET_GAP_NOT_TOUCHING");
    expect(roomCodes(fixtureRoom(gapLayout(5)))).toContain("CABINET_GAP_NOT_TOUCHING"); // within tolerance: no BLOCKER, but still a near-miss
    const m = fixtureRoom(gapLayout(5)).validation.messages.find((x) => x.code === "CABINET_GAP_NOT_TOUCHING");
    expect(m).toMatchObject({ severity: "WARNING", sourceObjectId: "obj_001" });
    expect(m?.message).toMatch(/OBJ-KIT-001 ↔ OBJ-KIT-002.*5 mm/);
  });
  it("suppresses CABINET_GAP_NOT_TOUCHING for a pair with an audited INTENTIONAL_GAP override", () => {
    const ov: RelationshipOverride = { overrideId: "OV-4", version: 1, type: "INTENTIONAL_GAP", objectIds: ["obj_001", "obj_002"], reason: "Dishwasher opening", author: "test designer", createdAt: "2026-09-26" };
    expect(roomCodes(fixtureRoom(gapLayout(5), { overrides: [ov] }))).not.toContain("CABINET_GAP_NOT_TOUCHING");
  });
  it("reports only the planning values the layout needs when they are NULL", () => {
    const needed = (r: ResolvedRoom) => r.validation.messages.filter((m) => m.code === "PLANNING_VALUE_UNDEFINED").map((m) => m.path);
    expect(needed(productionRoom())).toEqual(["planning.variables.MAX_RUN_LENGTH", "planning.variables.MIN_WALL_CLEARANCE", "planning.variables.SERVICE_VOID_REAR"]);
    expect(needed(productionRoom(gapLayout(40)))).toEqual(expect.arrayContaining(["planning.variables.MIN_CABINET_GAP", "planning.variables.MAX_GAP_WITHOUT_FILLER"]));
  });
});

describe("production configuration", () => {
  it("is PRODUCTION-classified and blocked", () => {
    const r = productionRoom();
    expect(r.trace.dataClassification).toBe("PRODUCTION");
    expect(r.validation.canApprove).toBe(false);
    expect(roomCodes(r)).toContain("PLANNING_STANDARD_NOT_APPROVED");
  });
});
