import type {
  CatalogSnapshot,
  ConstructionStandard,
  EdgeBandStandard,
  DesignObject,
  DesignVersion,
  ManufacturerAdapter,
  ObjectRelationship,
  PlacedObject,
  PlanningStandard,
  RelationshipOverride,
  ResolvedCabinet,
  ResolvedRoom,
  Room,
  RoomRun,
  RoomTrace,
  ValidationMessage,
  WallId,
} from "@lintel/types";
import { hash53, stableStringify } from "@lintel/types";
import { buildValidationResult } from "@lintel/rules-engine";
import { asQuarterTurn, BACK_WALL, containment, envelope, overlapVolume, placeBox, planDistance, relativeToWall, roomWalls, wallFrame } from "@lintel/geometry-engine";
import { PLANNING_VARIABLES } from "@lintel/catalog-engine";
import { ENGINE_VERSION } from "./context.js";
import { modelFingerprint } from "./fingerprint.js";
import { resolveCabinet } from "./resolve-cabinet.js";

export const ROOM_ENGINE_VERSION = ENGINE_VERSION;

export interface ResolveRoomInput {
  readonly designVersion: DesignVersion;
  readonly room: Room;
  readonly objects: readonly DesignObject[];
  readonly catalog: CatalogSnapshot;
  readonly standard: ConstructionStandard;
  readonly edgeBandStandard: EdgeBandStandard;
  readonly planning: PlanningStandard;
  readonly adapters: readonly ManufacturerAdapter[];
  /** Explicit, versioned, audited overrides. Normal cabinets need none. */
  readonly overrides?: readonly RelationshipOverride[];
}

const EPS = 1e-6;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const clean = (v: number): number => {
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
};

/** Pairs of walls that meet at a corner: first wall's right end meets second wall's left end. */
const CORNERS: readonly (readonly [WallId, WallId])[] = [
  ["A", "B"],
  ["B", "C"],
  ["C", "D"],
  ["D", "A"],
];

/**
 * Resolve every object in a room (M4). Pure and deterministic: output does not depend
 * on input order. Geometry is the source of truth for relationships; overrides are
 * explicit and audited. Planning checks use the PlanningStandard only — never invented values.
 */
export function resolveRoom(input: ResolveRoomInput): ResolvedRoom {
  const { room, designVersion, planning } = input;
  const overrides = [...(input.overrides ?? [])].sort((a, b) => cmp(a.overrideId, b.overrideId) || a.version - b.version);
  const msgs: ValidationMessage[] = [];
  const roomMsg = (code: string, severity: ValidationMessage["severity"], message: string, extra: Partial<ValidationMessage> = {}): void => {
    msgs.push({ code, severity, message, path: `rooms.${room.id}`, ...extra });
  };

  // 1. Deterministic order; duplicates are reported and ignored after the first.
  const sorted = [...input.objects].sort((a, b) => cmp(a.objectCode, b.objectCode) || cmp(a.objectId, b.objectId));
  const seenIds = new Set<string>();
  const seenCodes = new Set<string>();
  const objects: DesignObject[] = [];
  for (const o of sorted) {
    if (seenIds.has(o.objectId)) {
      roomMsg("DUPLICATE_OBJECT_ID", "BLOCKER", `Object id ${o.objectId} is used more than once; later occurrences ignored`, { sourceObjectId: o.objectId });
      continue;
    }
    if (seenCodes.has(o.objectCode)) {
      roomMsg("DUPLICATE_OBJECT_CODE", "BLOCKER", `Object code ${o.objectCode} is used more than once (component ids would collide); ${o.objectId} ignored`, { sourceObjectId: o.objectId });
      continue;
    }
    seenIds.add(o.objectId);
    seenCodes.add(o.objectCode);
    objects.push(o);
  }

  // 2–3. Membership, rotation, resolution.
  const cabinets: ResolvedCabinet[] = [];
  const placements: PlacedObject[] = [];
  const L = room.length;
  const W = room.width;
  const H = room.height;
  for (const o of objects) {
    if (o.roomId !== room.id || o.projectId !== room.projectId) {
      roomMsg("OBJECT_ROOM_MISMATCH", "BLOCKER", `${o.objectCode} belongs to room ${o.roomId} / project ${o.projectId}, not ${room.id} / ${room.projectId}`, { sourceObjectId: o.objectId });
    }
    const resolved = resolveCabinet({ designVersion, object: o, catalog: input.catalog, standard: input.standard, edgeBandStandard: input.edgeBandStandard, adapters: input.adapters });
    cabinets.push(resolved);
    const turn = asQuarterTurn(o.transform.rotationY);
    if (turn === null || o.transform.rotationX !== 0 || o.transform.rotationZ !== 0) {
      roomMsg("ROTATION_UNSUPPORTED", "BLOCKER", `${o.objectCode}: rotation (${o.transform.rotationX}, ${o.transform.rotationY}, ${o.transform.rotationZ}) — only 0/90/180/270 about the vertical axis are supported; object not placed`, {
        sourceObjectId: o.objectId,
      });
      continue;
    }
    const components = resolved.components.map((c) => ({ componentId: c.componentId, box: placeBox(c.geometry.local, o.transform) }));
    const env = envelope(components.map((c) => c.box));
    if (env === null) continue; // nothing generated → nothing to place (object messages explain why)
    const wallId = BACK_WALL[turn];
    const rel = relativeToWall(env, wallFrame(wallId, L, W));
    placements.push({ objectId: o.objectId, objectCode: o.objectCode, rotationY: turn, wallId, envelope: env, components, alongWall: { start: rel.start, end: rel.end }, distanceToWall: rel.distance });
  }

  // 4. Containment.
  for (const p of placements) {
    const violations = p.components.flatMap((c) => containment(c.box, L, W, H));
    const through = [...new Set(violations.filter((v) => v.kind === "THROUGH_WALL").map((v) => v.wallId ?? "?"))].sort();
    if (through.length > 0) {
      const by = Math.max(...violations.filter((v) => v.kind === "THROUGH_WALL").map((v) => v.by));
      roomMsg("OBJECT_THROUGH_WALL", "BLOCKER", `${p.objectCode} passes through wall ${through.join(", ")} by up to ${by} mm`, { sourceObjectId: p.objectId });
    }
    if (violations.some((v) => v.kind === "BELOW_FLOOR")) roomMsg("OBJECT_BELOW_FLOOR", "BLOCKER", `${p.objectCode} extends below the floor`, { sourceObjectId: p.objectId });
    if (violations.some((v) => v.kind === "ABOVE_CEILING")) roomMsg("OBJECT_ABOVE_CEILING", "BLOCKER", `${p.objectCode} extends above the ceiling`, { sourceObjectId: p.objectId });
  }

  // 5. Collisions: envelope pre-check, then exact component-level overlap (touching is allowed).
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i];
      const b = placements[j];
      if (a === undefined || b === undefined || overlapVolume(a.envelope, b.envelope) <= EPS) continue;
      let worst: { a: string; b: string; v: number } | null = null;
      for (const ca of a.components)
        for (const cb of b.components) {
          const v = overlapVolume(ca.box, cb.box);
          if (v > EPS && (worst === null || v > worst.v)) worst = { a: ca.componentId, b: cb.componentId, v };
        }
      if (worst !== null) {
        roomMsg("OBJECT_COLLISION", "BLOCKER", `${a.objectCode} collides with ${b.objectCode} (${worst.a} ∩ ${worst.b}, ${clean(worst.v / 1e9)} m³)`, {
          sourceObjectId: a.objectId,
          details: { with: b.objectId, componentA: worst.a, componentB: worst.b },
        });
      }
    }
  }

  // 6. Runs and relationships (derived from geometry).
  const relationships: ObjectRelationship[] = [];
  const runs: RoomRun[] = [];
  const adjacentPairs: { left: PlacedObject; right: PlacedObject; gap: number; wallId: WallId }[] = [];
  for (const wallId of ["A", "B", "C", "D"] as const) {
    const onWall = placements.filter((p) => p.wallId === wallId).sort((a, b) => a.alongWall.start - b.alongWall.start || cmp(a.objectCode, b.objectCode));
    // A run = objects on the same wall with their backs at the same distance from it.
    const groups = new Map<number, PlacedObject[]>();
    for (const p of onWall) {
      const list = groups.get(p.distanceToWall) ?? [];
      list.push(p);
      groups.set(p.distanceToWall, list);
    }
    const ordered = [...groups.values()].sort((a, b) => (a[0]?.alongWall.start ?? 0) - (b[0]?.alongWall.start ?? 0));
    ordered.forEach((members, k) => {
      const first = members[0];
      if (first === undefined) return;
      const start = Math.min(...members.map((m) => m.alongWall.start));
      const end = Math.max(...members.map((m) => m.alongWall.end));
      const runId = `RUN:${wallId}:${k + 1}`;
      runs.push({ runId, wallId, objectIds: members.map((m) => m.objectId), start, end, length: clean(end - start) });
      relationships.push({ relationshipId: `REL:RUN:${wallId}:${k + 1}`, type: "SAME_WALL_RUN", source: "DERIVED", objectIds: members.map((m) => m.objectId), wallIds: [wallId], gap: null, touching: null, overrideIds: [] });
      for (let i = 0; i + 1 < members.length; i++) {
        const left = members[i];
        const right = members[i + 1];
        if (left === undefined || right === undefined) continue;
        adjacentPairs.push({ left, right, gap: clean(right.alongWall.start - left.alongWall.end), wallId });
      }
    });
    for (const p of onWall) {
      relationships.push({ relationshipId: `REL:WALL:${p.objectId}`, type: "AGAINST_WALL", source: "DERIVED", objectIds: [p.objectId], wallIds: [wallId], gap: p.distanceToWall, touching: p.distanceToWall <= EPS, overrideIds: [] });
    }
  }

  // Overrides: validated, audited, applied only where M4 supports them.
  const byId = new Map(placements.map((p) => [p.objectId, p]));
  const pairKey = (a: string, b: string): string => [a, b].sort().join("|");
  const gapOverrides = new Map<string, string[]>();
  for (const ov of overrides) {
    const problems: string[] = [];
    if (ov.author.trim() === "" || ov.createdAt.trim() === "" || ov.reason.trim() === "") problems.push("author, createdAt and reason are required (audit)");
    for (const id of ov.objectIds) if (!byId.has(id)) problems.push(`unknown or unplaced object ${id}`);
    if (ov.type === "INTENTIONAL_GAP") {
      const [a, b] = ov.objectIds;
      if (ov.objectIds.length !== 2 || a === undefined || b === undefined) problems.push("INTENTIONAL_GAP needs exactly two objects");
      else if (!adjacentPairs.some((p) => pairKey(p.left.objectId, p.right.objectId) === pairKey(a, b))) problems.push("objects are not adjacent in a run");
    }
    if (problems.length > 0) {
      roomMsg("OVERRIDE_INVALID", "ERROR", `Override ${ov.overrideId} v${ov.version} (${ov.type}) ignored: ${problems.join("; ")}`);
      continue;
    }
    if (ov.type === "INTENTIONAL_GAP") {
      const k = pairKey(ov.objectIds[0] ?? "", ov.objectIds[1] ?? "");
      gapOverrides.set(k, [...(gapOverrides.get(k) ?? []), ov.overrideId]);
      roomMsg("OVERRIDE_APPLIED", "INFO", `Override ${ov.overrideId} v${ov.version} INTENTIONAL_GAP by ${ov.author} (${ov.createdAt}): ${ov.reason}`);
    } else {
      roomMsg("OVERRIDE_NOT_YET_SUPPORTED", "WARNING", `Override ${ov.overrideId} v${ov.version} (${ov.type}) recorded for audit; its effect is not modelled in M4`);
    }
  }
  for (const pair of adjacentPairs) {
    const ids = gapOverrides.get(pairKey(pair.left.objectId, pair.right.objectId)) ?? [];
    relationships.push({
      relationshipId: `REL:ADJ:${pair.left.objectId}:${pair.right.objectId}`,
      type: "ADJACENT",
      source: ids.length > 0 ? "OVERRIDE" : "DERIVED",
      objectIds: [pair.left.objectId, pair.right.objectId],
      wallIds: [pair.wallId],
      gap: pair.gap,
      touching: Math.abs(pair.gap) <= EPS,
      overrideIds: ids,
    });
  }
  for (const [w1, w2] of CORNERS) {
    const a = [...placements.filter((p) => p.wallId === w1)].sort((x, y) => y.alongWall.end - x.alongWall.end)[0];
    const b = [...placements.filter((p) => p.wallId === w2)].sort((x, y) => x.alongWall.start - y.alongWall.start)[0];
    if (a === undefined || b === undefined) continue;
    const gap = planDistance(a.envelope, b.envelope);
    const reach = Math.max(a.envelope.size.x, a.envelope.size.z, b.envelope.size.x, b.envelope.size.z);
    if (gap <= reach) {
      relationships.push({ relationshipId: `REL:CORNER:${w1}${w2}`, type: "CORNER", source: "DERIVED", objectIds: [a.objectId, b.objectId], wallIds: [w1, w2], gap, touching: gap <= EPS, overrideIds: [] });
    }
  }
  relationships.sort((x, y) => cmp(x.relationshipId, y.relationshipId));

  // 7. Planning checks (values only from the PlanningStandard).
  const needed = new Set<string>();
  const value = (key: string): number | null => {
    const v = planning.variables[key];
    if (typeof v === "number") return v;
    needed.add(key);
    return null;
  };
  for (const p of placements) {
    const min = value("SERVICE_VOID_REAR");
    if (min !== null && p.distanceToWall < min - EPS) roomMsg("SERVICE_VOID_BELOW_MINIMUM", "BLOCKER", `${p.objectCode}: back is ${p.distanceToWall} mm from wall ${p.wallId}; minimum service void ${min} mm`, { sourceObjectId: p.objectId });
  }
  for (const r of runs) {
    const wall = wallFrame(r.wallId, L, W);
    const min = value("MIN_WALL_CLEARANCE");
    const ends: [string, number][] = [
      ["left", r.start],
      ["right", clean(wall.length - r.end)],
    ];
    if (min !== null) for (const [side, d] of ends) if (d < min - EPS) roomMsg("WALL_CLEARANCE_BELOW_MINIMUM", "BLOCKER", `${r.runId}: ${side} end is ${d} mm from the wall; minimum ${min} mm`);
    const max = value("MAX_RUN_LENGTH");
    if (max !== null && r.length > max + EPS) roomMsg("RUN_TOO_LONG", "BLOCKER", `${r.runId} is ${r.length} mm long; maximum ${max} mm`);
  }
  for (const pair of adjacentPairs) {
    if (pair.gap <= EPS) continue; // touching (or overlapping → collision)
    if (gapOverrides.has(pairKey(pair.left.objectId, pair.right.objectId))) continue;
    const label = `${pair.left.objectCode} ↔ ${pair.right.objectCode}`;
    const minGap = value("MIN_CABINET_GAP");
    const maxGap = value("MAX_GAP_WITHOUT_FILLER");
    if (minGap === null || maxGap === null) continue;
    if (pair.gap < minGap - EPS) {
      roomMsg("GAP_BELOW_MINIMUM", "BLOCKER", `${label}: gap ${pair.gap} mm is below the minimum ${minGap} mm`, { sourceObjectId: pair.left.objectId });
    } else if (pair.gap > maxGap + EPS) {
      const threshold = value("FILLER_THRESHOLD");
      if (threshold === null) continue;
      if (pair.gap < threshold - EPS) roomMsg("GAP_UNFILLABLE", "BLOCKER", `${label}: gap ${pair.gap} mm needs a filler but is narrower than the filler threshold ${threshold} mm`, { sourceObjectId: pair.left.objectId });
      else roomMsg("FILLER_REQUIRED", "BLOCKER", `${label}: gap ${pair.gap} mm exceeds ${maxGap} mm; a filler (or an INTENTIONAL_GAP override) is required`, { sourceObjectId: pair.left.objectId });
    }
  }
  for (const key of [...needed].sort()) {
    const def = PLANNING_VARIABLES.find((v) => v.key === key);
    roomMsg("PLANNING_VALUE_UNDEFINED", "BLOCKER", `Planning value ${key} (${def?.description ?? "undeclared"}) is not defined in ${planning.standardId} v${planning.version}`, { path: `planning.variables.${key}` });
  }
  if (planning.status !== "APPROVED") {
    roomMsg("PLANNING_STANDARD_NOT_APPROVED", "BLOCKER", `planning standard ${planning.standardId} v${planning.version} is ${planning.status === "TEST_FIXTURE" ? "a TEST FIXTURE with synthetic values" : planning.status}`, { path: "planning" });
  }

  // 8. Trace + fingerprint.
  const fixtureSources = new Set<string>(cabinets.flatMap((c) => c.trace.testFixtureSources));
  if (planning.status === "TEST_FIXTURE") fixtureSources.add(`planning standard ${planning.standardId}`);
  if (fixtureSources.size > 0 && !msgs.some((m) => m.code === "TEST_FIXTURE_DATA_IN_USE")) {
    roomMsg("TEST_FIXTURE_DATA_IN_USE", "BLOCKER", `Room uses TEST_FIXTURE data and can never drive production: ${[...fixtureSources].sort().join("; ")}`);
  }
  const trace: RoomTrace = {
    engineVersion: ROOM_ENGINE_VERSION,
    designVersionId: designVersion.designVersionId,
    designVersionStatus: designVersion.status,
    projectId: room.projectId,
    roomId: room.id,
    dataClassification: fixtureSources.size > 0 ? "TEST_FIXTURE" : "PRODUCTION",
    testFixtureSources: [...fixtureSources].sort(),
    planningStandard: { id: planning.standardId, version: planning.version, status: planning.status },
    catalogVersion: input.catalog.catalogVersion,
    objects: cabinets.map((c) => ({ objectId: c.object.objectId, objectCode: c.object.objectCode, modelFingerprint: modelFingerprint(c) })),
    overrides: overrides.map((o) => ({ overrideId: o.overrideId, version: o.version })),
  };
  const roomData = { id: room.id, name: room.name, length: L, width: W, height: H, wallThickness: room.wallThickness, walls: roomWalls(L, W, H, room.wallThickness) };
  const roomFingerprint = hash53(stableStringify({ room: roomData, trace, placements, overrides }));
  return {
    trace,
    room: roomData,
    cabinets,
    placements,
    runs,
    relationships,
    overrides,
    roomFingerprint,
    validation: buildValidationResult([...cabinets.flatMap((c) => c.validation.messages), ...msgs]),
  };
}
