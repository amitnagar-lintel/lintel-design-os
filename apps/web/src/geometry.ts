/**
 * Pure layout helpers of the pilot UI. They only place user input (where a cabinet goes along wall A) and scale the
 * API's resolved model for drawing; they never compute construction, validation, quantities or prices.
 */

export interface RunItem {
  readonly id: string;
  readonly x: number;
  readonly width: number;
}

/**
 * "Arrange run": the cabinets of wall A edge to edge in their current left-to-right order, starting at `start`
 * (the leftmost cabinet's current position unless given). Returns only the cabinets whose position changes.
 */
export function arrangeRun(items: readonly RunItem[], start?: number): { id: string; x: number }[] {
  if (items.length === 0) return [];
  const ordered = [...items].sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1));
  let x = start ?? Math.max(0, ordered[0]?.x ?? 0);
  const out: { id: string; x: number }[] = [];
  for (const it of ordered) {
    if (it.x !== x) out.push({ id: it.id, x });
    x += it.width;
  }
  return out;
}

/** The next free position at the right end of the run (0 for an empty wall). */
export function nextFreeX(items: readonly RunItem[]): number {
  return items.reduce((m, it) => Math.max(m, it.x + it.width), 0);
}

/** Whether a corner leg's along-wall `end` sits flush against the FAR end of a `wallLengthMm`-long wall (a
 * "return leg", `@lintel/cabinet-engine`'s `cornerPairPlacement`: `leg1Along = wallLength - width`) rather than
 * near its start (a "front leg", which begins a little way in and behaves like any ordinary cabinet for
 * `nextFreeX`'s existing rightward-append — see `nextFreeAlong` below). */
export function isFarEndAnchored(legEndAlongMm: number, wallLengthMm: number, epsMm = 1): boolean {
  return Math.abs(legEndAlongMm - wallLengthMm) <= epsMm;
}

/**
 * Hardening (P1-1, run + corner continuity): where a new `newWidthMm`-wide cabinet should go on a wall, corner-
 * aware. With no `farEndAnchorAlongMm`, this is exactly `nextFreeX` — append after whatever is already on the
 * wall (0 for an empty wall; a corner leg flush against the wall's NEAR end already behaves correctly here,
 * since `items` including it makes `nextFreeX` start right after its own end).
 *
 * A corner leg flush against the wall's FAR end is different: appending after it would place new cabinets past
 * the room's own corner. Given `farEndAnchorAlongMm` (that leg's own along-wall `start`, which never moves —
 * the leg sits at the room's physical corner regardless of what else is on the wall), new cabinets instead pack
 * against it and grow AWAY from the corner — the mirror image of the ordinary case — so a run built cabinet-by-
 * cabinet after its corner ends up in exactly the same place as one built before it (`items` here excludes the
 * corner leg itself, which is never in this "pack toward the corner" chain).
 */
export function nextFreeAlong(items: readonly RunItem[], newWidthMm: number, farEndAnchorAlongMm?: number): number {
  if (farEndAnchorAlongMm === undefined) return nextFreeX(items);
  const leftEdge = items.reduce((m, it) => Math.min(m, it.x), farEndAnchorAlongMm);
  return leftEdge - newWidthMm;
}

/** A uniform scale that fits a `w` × `h` millimetre extent into a `boxW` × `boxH` pixel box with `pad` pixels around. */
export function fit(w: number, h: number, boxW: number, boxH: number, pad = 24): { scale: number; ox: number; oy: number } {
  if (w <= 0 || h <= 0) return { scale: 1, ox: pad, oy: pad };
  const scale = Math.min((boxW - 2 * pad) / w, (boxH - 2 * pad) / h);
  return { scale, ox: (boxW - w * scale) / 2, oy: (boxH - h * scale) / 2 };
}

/** Whole millimetres for display, e.g. 4200 → "4200 mm". */
export const mm = (v: number): string => `${String(Math.round(v))} mm`;

export type WallId = "A" | "B" | "C" | "D";
export type QuarterTurn = 0 | 90 | 180 | 270;

/**
 * Slice 6A (wall placement + snapping). These mirror `packages/geometry-engine/src/room.ts`'s `wallFrame` /
 * `BACK_WALL` exactly (verified against `tests/support/room.ts`'s golden L-layout fixture: a 600 mm cabinet on
 * wall D of the 4200×3200 KITCHEN room at transform `{x:0,z:1200,rotationY:90}` has `alongWall.start === 2000`
 * and `distanceToWall === 0` there) so a position the designer picks in the browser resolves to the exact same
 * room/wall the engine will independently derive from the resulting `transform`. Room coordinates: x ∈ [0,
 * length] along wall A, z ∈ [0, width]; wall A is z=0, wall B is x=length, wall C is z=width, wall D is x=0.
 */
export const BACK_WALL: Readonly<Record<QuarterTurn, WallId>> = { 0: "A", 90: "D", 180: "C", 270: "B" };

/**
 * Which wall a cabinet-local origin `(x, z)` is against, and its along-wall / distance-from-wall coordinates —
 * the exact inverse of `placeOnWall` below. Because each wall's along/distance formula is affine-linear, applying
 * it directly to the origin (rather than to all 4 footprint corners, as the engine does) recovers the same
 * along/distance values regardless of rotation — no cabinet dimensions are needed to compute it.
 */
export function nearestWall(x: number, z: number, roomLength: number, roomWidth: number): { wallId: WallId; along: number; distance: number } {
  const options: { wallId: WallId; along: number; distance: number }[] = [
    { wallId: "A", along: x, distance: z },
    { wallId: "B", along: z, distance: roomLength - x },
    { wallId: "C", along: roomLength - x, distance: roomWidth - z },
    { wallId: "D", along: roomWidth - z, distance: x },
  ];
  return options.reduce((best, o) => (o.distance < best.distance ? o : best));
}

/** The API stores millimetres as `numeric(10,2)` and rejects anything with more than 2 decimal places
 * (`apps/api/src/common/http/measures.ts`'s `Millimetres`); a drag's pointer-to-mm conversion (dividing by the
 * Plan view's non-round pixel scale) produces far more decimals than that, so every mm value this module hands
 * to the API is rounded here first. */
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** The cabinet-local origin `(x, z)` and quarter-turn rotation that puts a cabinet's back flush against `wallId`
 * at `alongMm` from that wall's left end (seen facing it from inside the room) and `distanceMm` from its face. */
export function placeOnWall(wallId: WallId, alongMm: number, distanceMm: number, roomLength: number, roomWidth: number): { x: number; z: number; rotationY: QuarterTurn } {
  const { x, z, rotationY } = ((): { x: number; z: number; rotationY: QuarterTurn } => {
    switch (wallId) {
      case "A": return { x: alongMm, z: distanceMm, rotationY: 0 };
      case "B": return { x: roomLength - distanceMm, z: alongMm, rotationY: 270 };
      case "C": return { x: roomLength - alongMm, z: roomWidth - distanceMm, rotationY: 180 };
      case "D": return { x: distanceMm, z: roomWidth - alongMm, rotationY: 90 };
    }
  })();
  return { x: round2(x), z: round2(z), rotationY };
}

/** The room-plan bounding box (min corner + size) of a cabinet footprint at `(x, z)`/`rotationY`, given its
 * along-wall `widthMm` and perpendicular `depthMm` — mirrors `geometry-engine`'s `toWorld`/`worldCorners` for the
 * four supported quarter turns. Used only for an in-progress drag preview; the API's own resolved `envelope` is
 * authoritative once a move is saved. */
export function footprintBox(x: number, z: number, rotationY: QuarterTurn, widthMm: number, depthMm: number): { minX: number; minZ: number; sizeX: number; sizeZ: number } {
  switch (rotationY) {
    case 0: return { minX: x, minZ: z, sizeX: widthMm, sizeZ: depthMm };
    case 90: return { minX: x, minZ: z - widthMm, sizeX: depthMm, sizeZ: widthMm };
    case 180: return { minX: x - widthMm, minZ: z - depthMm, sizeX: widthMm, sizeZ: depthMm };
    case 270: return { minX: x - depthMm, minZ: z, sizeX: depthMm, sizeZ: widthMm };
  }
}

/** Clamp an along-wall position so a `widthMm`-wide footprint stays within a wall of `wallLengthMm`. */
export function clampAlong(alongMm: number, widthMm: number, wallLengthMm: number): number {
  return Math.min(Math.max(alongMm, 0), Math.max(0, wallLengthMm - widthMm));
}

/**
 * Slice 6B (cabinet runs + adjacency): if dragging a `widthMm`-wide footprint to `alongMm` would leave either of
 * its edges within `thresholdMm` of an existing neighbour's edge on the same wall, snap that edge flush (gap 0)
 * instead — the same "cabinet aligns to an adjacent cabinet without overlap" behaviour a real design tool gives,
 * so a designer building a run doesn't have to hit an exact pixel to close a gap. Neighbours are the *other*
 * cabinets already placed on the candidate wall (their own `alongWall.start/end`, as the API already resolves —
 * this never recomputes placement itself). The closest snap within threshold wins; otherwise `alongMm` is
 * returned unchanged (still subject to `clampAlong`). Becoming flush against a neighbour is exactly what makes
 * the engine's own derived `SAME_WALL_RUN`/`ADJACENT` relationships pick the dragged cabinet up as a run member
 * (`packages/design-engine/src/room.ts`) — there is no separate "run" to join.
 */
export function snapToNeighbors(alongMm: number, widthMm: number, neighbors: readonly { readonly start: number; readonly end: number }[], thresholdMm = 150): number {
  let best: { distance: number; along: number } | null = null;
  for (const n of neighbors) {
    const snapStartToRight = { distance: Math.abs(alongMm - n.end), along: n.end };
    const snapEndToLeft = { distance: Math.abs(alongMm + widthMm - n.start), along: n.start - widthMm };
    for (const candidate of [snapStartToRight, snapEndToLeft]) {
      if (candidate.distance <= thresholdMm && (best === null || candidate.distance < best.distance)) best = candidate;
    }
  }
  return best === null ? alongMm : best.along;
}

/** Paise → "₹12,345.00" (display only; the amount itself comes from the API). */
export function inr(paise: unknown): string {
  if (typeof paise !== "number" || !Number.isFinite(paise)) return "—";
  const rupees = Math.trunc(paise / 100);
  const p = Math.abs(paise % 100);
  return `₹${rupees.toLocaleString("en-IN")}.${String(p).padStart(2, "0")}`;
}
