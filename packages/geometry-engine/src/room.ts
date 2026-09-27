/**
 * Room geometry (M4): quarter-turn placement, wall frames, containment. Pure maths.
 *
 * Room interior: x ∈ [0, L] along wall A, z ∈ [0, W], y ∈ [0, H].
 * Each wall's frame runs left → right as seen from inside the room facing that wall,
 * which is also the local +X direction of a cabinet whose back faces that wall.
 */
import type { Box3, QuarterTurn, RoomWall, Transform, WallId } from "@lintel/types";
import { envelope, worldCorners } from "./index.js";

export const QUARTER_TURNS: readonly QuarterTurn[] = [0, 90, 180, 270];

export function asQuarterTurn(rotationY: number): QuarterTurn | null {
  const r = ((rotationY % 360) + 360) % 360;
  return (QUARTER_TURNS as readonly number[]).includes(r) ? (r as QuarterTurn) : null;
}

/** The wall a cabinet's back faces for each quarter turn (back = local −Z). */
export const BACK_WALL: Readonly<Record<QuarterTurn, WallId>> = { 0: "A", 90: "D", 180: "C", 270: "B" };

/** Box in room coordinates (exact for quarter turns; corners rounded to 1e-9 mm). */
export function placeBox(local: Box3, t: Transform): Box3 {
  const placed = envelope(worldCorners(local, t).map((p) => ({ min: p, size: { x: 0, y: 0, z: 0 } })));
  if (placed === null) throw new Error("unreachable: 8 corners");
  return placed;
}

export interface WallFrame {
  readonly wallId: WallId;
  /** Along-wall coordinate of a plan point (mm from the wall's left end). */
  along(x: number, z: number): number;
  /** Distance of a plan point from the wall's inside face (positive into the room). */
  distance(x: number, z: number): number;
  readonly length: number;
}

export function wallFrame(wallId: WallId, L: number, W: number): WallFrame {
  switch (wallId) {
    case "A":
      return { wallId, length: L, along: (x) => x, distance: (_x, z) => z };
    case "B":
      return { wallId, length: W, along: (_x, z) => z, distance: (x) => L - x };
    case "C":
      return { wallId, length: L, along: (x) => L - x, distance: (_x, z) => W - z };
    case "D":
      return { wallId, length: W, along: (_x, z) => W - z, distance: (x) => x };
  }
}

const clean = (v: number): number => {
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
};

/** Along-wall range and minimum distance to the wall of a plan box. */
export function relativeToWall(box: Box3, frame: WallFrame): { start: number; end: number; distance: number } {
  const xs = [box.min.x, box.min.x + box.size.x];
  const zs = [box.min.z, box.min.z + box.size.z];
  const along: number[] = [];
  const dist: number[] = [];
  for (const x of xs)
    for (const z of zs) {
      along.push(frame.along(x, z));
      dist.push(frame.distance(x, z));
    }
  return { start: clean(Math.min(...along)), end: clean(Math.max(...along)), distance: clean(Math.min(...dist)) };
}

/**
 * The exact inverse of `wallFrame`'s `along`/`distance`: the cabinet-local origin (the `x, z` a `Transform`
 * carries) and quarter-turn rotation that puts a cabinet's back flush against `wallId` at `alongMm` from that
 * wall's left end and `distanceMm` from its face. Each wall's along/distance formula is affine-linear, so this
 * holds regardless of a cabinet's own width/depth — no footprint dimensions are needed to invert it (Design
 * Studio Slice 6A's `apps/web/src/geometry.ts` derived this same formula independently for the browser's own
 * drag-to-wall-snap interaction; this is the canonical, engine-side copy for other packages — `corner.ts`'s
 * room-corner placement among them — that cannot depend on `apps/web`).
 */
export function wallOrigin(wallId: WallId, alongMm: number, distanceMm: number, roomLength: number, roomWidth: number): { readonly x: number; readonly z: number; readonly rotationY: QuarterTurn } {
  switch (wallId) {
    case "A": return { x: alongMm, z: distanceMm, rotationY: 0 };
    case "B": return { x: roomLength - distanceMm, z: alongMm, rotationY: 270 };
    case "C": return { x: roomLength - alongMm, z: roomWidth - distanceMm, rotationY: 180 };
    case "D": return { x: distanceMm, z: roomWidth - alongMm, rotationY: 90 };
  }
}

export function roomWalls(L: number, W: number, H: number, thickness: number): RoomWall[] {
  return [
    { wallId: "A", start: { x: 0, z: 0 }, end: { x: L, z: 0 }, length: L, height: H, thickness },
    { wallId: "B", start: { x: L, z: 0 }, end: { x: L, z: W }, length: W, height: H, thickness },
    { wallId: "C", start: { x: L, z: W }, end: { x: 0, z: W }, length: L, height: H, thickness },
    { wallId: "D", start: { x: 0, z: W }, end: { x: 0, z: 0 }, length: W, height: H, thickness },
  ];
}

export interface ContainmentViolation {
  readonly kind: "THROUGH_WALL" | "BELOW_FLOOR" | "ABOVE_CEILING";
  readonly wallId: WallId | null;
  readonly by: number;
}

/** How a box leaves the room interior (empty = contained). Tolerance 1e-6 mm. */
export function containment(box: Box3, L: number, W: number, H: number): ContainmentViolation[] {
  const EPS = 1e-6;
  const out: ContainmentViolation[] = [];
  const x1 = box.min.x + box.size.x;
  const y1 = box.min.y + box.size.y;
  const z1 = box.min.z + box.size.z;
  if (box.min.z < -EPS) out.push({ kind: "THROUGH_WALL", wallId: "A", by: clean(-box.min.z) });
  if (x1 > L + EPS) out.push({ kind: "THROUGH_WALL", wallId: "B", by: clean(x1 - L) });
  if (z1 > W + EPS) out.push({ kind: "THROUGH_WALL", wallId: "C", by: clean(z1 - W) });
  if (box.min.x < -EPS) out.push({ kind: "THROUGH_WALL", wallId: "D", by: clean(-box.min.x) });
  if (box.min.y < -EPS) out.push({ kind: "BELOW_FLOOR", wallId: null, by: clean(-box.min.y) });
  if (y1 > H + EPS) out.push({ kind: "ABOVE_CEILING", wallId: null, by: clean(y1 - H) });
  return out;
}

/** Shortest plan (XZ) distance between two boxes; 0 when touching or overlapping. */
export function planDistance(a: Box3, b: Box3): number {
  const dx = Math.max(0, a.min.x - (b.min.x + b.size.x), b.min.x - (a.min.x + a.size.x));
  const dz = Math.max(0, a.min.z - (b.min.z + b.size.z), b.min.z - (a.min.z + a.size.z));
  return clean(Math.hypot(dx, dz));
}
