/**
 * Design Studio — Slice 4 (D2/D7): placement math for a two-object corner cabinet pair.
 *
 * `@lintel/geometry-engine` supports only axis-aligned boxes with quarter-turn placement (one `rotationY` per
 * whole object; see `model.ts`'s `CornerConfiguration` doc comment) — an L-shaped carcass cannot be one
 * object's component set. A corner base cabinet is therefore authored as two ordinary `CabinetInstance`s (the
 * exact same shutter cabinet Slice 1 already builds), positioned so their footprints meet exactly at a room
 * corner without overlapping (`design-engine/room.ts`'s `OBJECT_COLLISION` is a BLOCKER on any positive overlap
 * volume). The engine's own `CORNER` relationship (already derived today, `design-engine/room.ts`'s `CORNERS`
 * loop) then recognises the pair automatically — no new relationship type or engine change was needed.
 *
 * V1 scope: only the room's D-A corner (wall D meets wall A) is supported, matching
 * `@lintel/geometry-engine`'s own `BACK_WALL` quarter-turn convention (`rotationY 0 → wall A`,
 * `rotationY 90 → wall D`) and the one room-corner case the repository's own golden fixture
 * (`tests/golden/fixtures/room/kitchen.l-layout.*`) already exercises. Generalising to the other three room
 * corners (A-B, B-C, C-D) is a straightforward, real follow-up using the same `wallFrame` axes
 * (`@lintel/geometry-engine`'s `room.ts`) — not implemented here because only this one geometry has been
 * verified end to end.
 */
import type { Millimetres } from "@lintel/types";

export interface CornerLegSpec {
  readonly widthMm: Millimetres;
  readonly depthMm: Millimetres;
}

export interface CornerLegTransform {
  readonly position: { readonly xMm: Millimetres; readonly yMm: Millimetres; readonly zMm: Millimetres };
  readonly rotationY: 0 | 90 | 180 | 270;
}

/**
 * The return leg sits against wall D (`rotationY: 90`), its footprint hugging the D-A room corner
 * (world x ∈ [0, depth], z ∈ [0, width]). The front leg sits against wall A (`rotationY: 0`), starting exactly
 * where the return leg's depth ends (world x ∈ [returnLeg.depthMm, …], z ∈ [0, depth]) — touching, not
 * overlapping (`planDistance` between the two envelopes is 0, so `OBJECT_COLLISION` never fires and the
 * derived `CORNER` relationship reports `touching: true`).
 *
 * This assumes each leg's own front never projects beyond its own carcass depth: an INSET shutter is bounded
 * by the carcass depth (`kit-base-standard.ts`'s `SHUTTER_INSET` sits at `z: D - T_FRONT`), but an OVERLAY
 * shutter sits `SHUTTER_BACK_GAP` proud of it (`z: D + SHUTTER_BACK_GAP`) — enough, for any real construction
 * standard value, to make the return leg's shutter collide with the front leg's side panel. The caller must
 * build each leg with `overlay: "INSET"`.
 */
export function cornerPairPlacementDA(returnLeg: CornerLegSpec): { readonly returnLeg: CornerLegTransform; readonly frontLeg: CornerLegTransform } {
  return {
    returnLeg: { position: { xMm: 0, yMm: 0, zMm: returnLeg.widthMm }, rotationY: 90 },
    frontLeg: { position: { xMm: returnLeg.depthMm, yMm: 0, zMm: 0 }, rotationY: 0 },
  };
}
