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

/** Paise → "₹12,345.00" (display only; the amount itself comes from the API). */
export function inr(paise: unknown): string {
  if (typeof paise !== "number" || !Number.isFinite(paise)) return "—";
  const rupees = Math.trunc(paise / 100);
  const p = Math.abs(paise % 100);
  return `₹${rupees.toLocaleString("en-IN")}.${String(p).padStart(2, "0")}`;
}
