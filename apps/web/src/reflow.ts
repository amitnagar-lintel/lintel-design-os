/**
 * Hardening (real-designer UX audit P0-3, generalised in P1-3): when a cabinet's width changes, its same-run
 * neighbours to its right must shift by the same amount to stay contiguous — resizing must never silently leave
 * an overlap. This reads only the resolved model's own run membership and along-wall coordinates
 * (`packages/design-engine/src/room.ts`'s derived `runs`/`relationships` — a run is emergent from geometry,
 * never a separate entity here either); it computes no new geometry of its own, only which existing objects
 * would need a `PATCH position`, and refuses the whole plan (leaving nothing to persist) rather than applying a
 * partial, unsafe shift.
 *
 * P1-3: a corner leg downstream of the resized cabinet is NOT an automatic refusal. Its own position is fixed —
 * it sits at the room's physical corner (`cornerAttach.ts`), never shiftable — but everything BETWEEN the
 * resized cabinet and that leg still shifts normally, with the leg's own current position as the boundary those
 * cabinets must not cross (in place of the wall's own end). A shrink only ever needs less of that space, so it
 * always succeeds; a grow is refused, with the previous state untouched, only if it would actually need to
 * cross into the leg's fixed position.
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
  const resizedObj = input.objectsByLineageId.get(resizedLineageId);
  if (resizedObj === undefined) throw new Error(`unreachable: resized cabinet ${resizedLineageId} is not in the resolved model`);

  // A corner leg is always the last member of its wall's run (`cornerAttach.ts` keeps it flush against the
  // room's actual corner), so at most one can appear in `after`; only the cabinets BEFORE it are shiftable —
  // the leg itself never moves, and anything (unexpectedly) beyond it is left alone entirely.
  const cornerIdx = after.findIndex((id) => input.cornerLineageIds.has(id));
  const cornerId = cornerIdx === -1 ? undefined : after[cornerIdx];
  const movable = cornerIdx === -1 ? after : after.slice(0, cornerIdx);
  const fixedLeg = cornerId === undefined ? undefined : input.objectsByLineageId.get(cornerId);
  if (cornerId !== undefined && fixedLeg === undefined) throw new Error(`unreachable: corner leg ${cornerId} is not in the resolved model`);
  const boundaryMm = fixedLeg === undefined ? input.wallLength : fixedLeg.alongWall.start;
  const blockedInto = (): string =>
    fixedLeg === undefined ? `outside wall ${input.wallId} (0–${String(input.wallLength)} mm)` : `into the ${fixedLeg.objectCode} corner cabinet (fixed at ${String(Math.round(boundaryMm))} mm on wall ${input.wallId})`;

  if (movable.length === 0) {
    // The resized cabinet is immediately followed by the corner leg (or nothing else) — there's no downstream
    // neighbour to shift, but growing the resized cabinet itself could still reach into the leg's fixed spot.
    const newEnd = resizedObj.alongWall.end + deltaMm;
    if (fixedLeg === undefined || newEnd <= boundaryMm + EPS) return { kind: "none" };
    return { kind: "blocked", message: `Growing ${resizedObj.objectCode} to end at ${String(Math.round(newEnd))} mm would put it ${blockedInto()}. Choose a smaller change.` };
  }

  const shifted = movable.map((id) => {
    const o = input.objectsByLineageId.get(id);
    if (o === undefined) throw new Error(`unreachable: run member ${id} is not in the resolved model`);
    return { o, along: o.alongWall.start + deltaMm, end: o.alongWall.end + deltaMm };
  });
  const overflow = shifted.find((s) => s.end > boundaryMm + EPS || s.along < -EPS);
  if (overflow !== undefined) {
    return {
      kind: "blocked",
      message: `Shifting ${overflow.o.objectCode} to ${String(Math.round(overflow.along))}–${String(Math.round(overflow.end))} mm would put it ${blockedInto()}. Choose a smaller change, or move cabinets out of the way first.`,
    };
  }
  return { kind: "shift", shifts: shifted.map((s) => ({ objectId: s.o.objectId, along: s.along, distanceToWall: s.o.distanceToWall, yMm: s.o.yMm })) };
}
