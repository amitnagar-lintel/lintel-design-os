/**
 * Design Studio — Slice 4 (D2/D7): placement math for a two-object corner cabinet pair. Generalised to all 4
 * room corners in Slice 6C (was D-A only).
 *
 * `@lintel/geometry-engine` supports only axis-aligned boxes with quarter-turn placement (one `rotationY` per
 * whole object; see `model.ts`'s `CornerConfiguration` doc comment) — an L-shaped carcass cannot be one
 * object's component set. A corner base cabinet is therefore authored as two ordinary `CabinetInstance`s (the
 * exact same shutter cabinet Slice 1 already builds), positioned so their footprints meet exactly at a room
 * corner without overlapping (`design-engine/room.ts`'s `OBJECT_COLLISION` is a BLOCKER on any positive overlap
 * volume). The engine's own `CORNER` relationship (already derived today, `design-engine/room.ts`'s `CORNERS`
 * loop) then recognises the pair automatically — no new relationship type or engine change was needed.
 *
 * A room corner is named by its two walls in the same order `design-engine/room.ts`'s own `CORNERS` list uses
 * (`[["A","B"],["B","C"],["C","D"],["D","A"]]`): the first wall's right end meets the second wall's left end.
 * `returnLeg` sits flush against the first wall, at its right end; `frontLeg` sits flush against the second
 * wall, starting exactly where the return leg's depth ends — touching, not overlapping (`planDistance` between
 * the two envelopes is 0, so `OBJECT_COLLISION` never fires and the derived `CORNER` relationship reports
 * `touching: true`). `wallOrigin` (`@lintel/geometry-engine`) is the exact inverse of `wallFrame`'s own
 * along/distance math, so this holds for any room size and any of the 4 corners without hand-deriving the
 * per-wall formulas again here.
 *
 * This assumes each leg's own front never projects beyond its own carcass depth: an INSET shutter is bounded
 * by the carcass depth (`kit-base-standard.ts`'s `SHUTTER_INSET` sits at `z: D - T_FRONT`), but an OVERLAY
 * shutter sits `SHUTTER_BACK_GAP` proud of it (`z: D + SHUTTER_BACK_GAP`) — enough, for any real construction
 * standard value, to make the return leg's shutter collide with the front leg's side panel. The caller must
 * build each leg with `overlay: "INSET"`.
 */
import type { Millimetres } from "@lintel/types";
import { wallOrigin } from "@lintel/geometry-engine";

export type CornerId = "AB" | "BC" | "CD" | "DA";

/** The two walls a corner id names, first-wall's-right-end-meets-second-wall's-left-end, matching
 * `design-engine/room.ts`'s own `CORNERS` list. */
const CORNER_WALLS: Readonly<Record<CornerId, readonly ["A" | "B" | "C" | "D", "A" | "B" | "C" | "D"]>> = {
  AB: ["A", "B"],
  BC: ["B", "C"],
  CD: ["C", "D"],
  DA: ["D", "A"],
};

export interface CornerLegSpec {
  readonly widthMm: Millimetres;
  readonly depthMm: Millimetres;
}

export interface CornerLegTransform {
  readonly position: { readonly xMm: Millimetres; readonly yMm: Millimetres; readonly zMm: Millimetres };
  readonly rotationY: 0 | 90 | 180 | 270;
}

const wallLength = (wallId: "A" | "B" | "C" | "D", roomLengthMm: number, roomWidthMm: number): number => (wallId === "A" || wallId === "C" ? roomLengthMm : roomWidthMm);

/**
 * Places a corner cabinet pair at any of the room's 4 corners. `returnLeg` sits flush against `corner`'s first
 * wall, at that wall's right end; `frontLeg` sits flush against the second wall, starting where the return
 * leg's depth ends. Room dimensions are required for every corner but D-A (D-A's meeting point is the room
 * origin regardless of room size — the one case Slice 4 originally shipped without them).
 */
export function cornerPairPlacement(corner: CornerId, returnLeg: CornerLegSpec, room: { readonly lengthMm: Millimetres; readonly widthMm: Millimetres }): { readonly returnLeg: CornerLegTransform; readonly frontLeg: CornerLegTransform } {
  const [w1, w2] = CORNER_WALLS[corner];
  const leg1Along = wallLength(w1, room.lengthMm, room.widthMm) - returnLeg.widthMm;
  const o1 = wallOrigin(w1, leg1Along, 0, room.lengthMm, room.widthMm);
  const o2 = wallOrigin(w2, returnLeg.depthMm, 0, room.lengthMm, room.widthMm);
  return {
    returnLeg: { position: { xMm: o1.x, yMm: 0, zMm: o1.z }, rotationY: o1.rotationY },
    frontLeg: { position: { xMm: o2.x, yMm: 0, zMm: o2.z }, rotationY: o2.rotationY },
  };
}

/** The room's D-A corner only (Slice 4's original, room-size-independent case) — a thin convenience wrapper
 * over `cornerPairPlacement` for callers that don't have room dimensions handy. */
export function cornerPairPlacementDA(returnLeg: CornerLegSpec): { readonly returnLeg: CornerLegTransform; readonly frontLeg: CornerLegTransform } {
  return cornerPairPlacement("DA", returnLeg, { lengthMm: 0, widthMm: 0 });
}
