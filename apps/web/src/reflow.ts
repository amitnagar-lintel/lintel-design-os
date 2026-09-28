/**
 * Hardening (real-designer UX audit P0-3): when a cabinet's width changes, its same-run neighbours to its right
 * must shift by the same amount to stay contiguous — resizing must never silently leave an overlap. This reads
 * only the resolved model's own run membership and along-wall coordinates (`packages/design-engine/src/room.ts`'s
 * derived `runs`/`relationships` — a run is emergent from geometry, never a separate entity here either); it
 * computes no new geometry of its own, only which existing objects would need a `PATCH position`, and refuses the
 * whole plan (leaving nothing to persist) rather than applying a partial, unsafe shift.
 */
import type { WallId } from "./geometry";

export interface ReflowObject {
  readonly objectId: string;
  readonly objectCode: string;
  readonly alongWall: { readonly start: number; readonly end: number };
  readonly distanceToWall: number;
  readonly yMm: number;
}

export interface ReflowInput {
  /** The resized cabinet's run, left to right (the engine's own run order). */
  readonly runLineageIds: readonly string[];
  readonly wallId: WallId;
  readonly wallLength: number;
  /** Lineage ids that are one leg of an L-corner — never shifted (their position comes from the room corner, not
   * run adjacency); a run that needs one of these to move is reported as blocked, not silently skipped. */
  readonly cornerLineageIds: ReadonlySet<string>;
  readonly objectsByLineageId: ReadonlyMap<string, ReflowObject>;
}

export type ReflowPlan =
  | { readonly kind: "none" }
  | { readonly kind: "blocked"; readonly message: string }
  | { readonly kind: "shift"; readonly shifts: readonly { readonly objectId: string; readonly along: number; readonly distanceToWall: number; readonly yMm: number }[] };

const EPS = 1e-6;

export function planReflow(input: ReflowInput, resizedLineageId: string, deltaMm: number): ReflowPlan {
  if (Math.abs(deltaMm) <= EPS) return { kind: "none" };
  const idx = input.runLineageIds.indexOf(resizedLineageId);
  if (idx === -1) return { kind: "none" };
  const after = input.runLineageIds.slice(idx + 1);
  if (after.length === 0) return { kind: "none" };

  const blockedCornerId = after.find((id) => input.cornerLineageIds.has(id));
  if (blockedCornerId !== undefined) {
    const o = input.objectsByLineageId.get(blockedCornerId);
    return { kind: "blocked", message: `${o?.objectCode ?? blockedCornerId} is part of a corner and can't be shifted automatically — move or resize it directly instead.` };
  }

  const shifted = after.map((id) => {
    const o = input.objectsByLineageId.get(id);
    if (o === undefined) throw new Error(`unreachable: run member ${id} is not in the resolved model`);
    return { o, along: o.alongWall.start + deltaMm, end: o.alongWall.end + deltaMm };
  });
  const overflow = shifted.find((s) => s.end > input.wallLength + EPS || s.along < -EPS);
  if (overflow !== undefined) {
    return {
      kind: "blocked",
      message: `Shifting ${overflow.o.objectCode} to ${String(Math.round(overflow.along))}–${String(Math.round(overflow.end))} mm would put it outside wall ${input.wallId} (0–${String(input.wallLength)} mm). Choose a smaller change, or move cabinets out of the way first.`,
    };
  }
  return { kind: "shift", shifts: shifted.map((s) => ({ objectId: s.o.objectId, along: s.along, distanceToWall: s.o.distanceToWall, yMm: s.o.yMm })) };
}
