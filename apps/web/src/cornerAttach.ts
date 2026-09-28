/**
 * Hardening (P1-1, run + corner continuity): closing an accidental gap — or making room to avoid an overlap —
 * between a wall's existing run and a corner leg that's just been added to (one end of) that same wall. The
 * corner leg itself never moves (it sits at the room's actual physical corner, `@lintel/cabinet-engine`'s
 * `cornerPairPlacement`); the *pre-existing* chain of ordinary cabinets on that wall is shifted, as one rigid
 * group (preserving whatever gaps already existed *within* it — this only ever closes the single outer gap to
 * the corner), so the run and the corner leg end up exactly touching regardless of whether the run or the
 * corner was built first (`addCornerPair` in `screens/DesignStudio.tsx` calls this for both of a new pair's
 * legs, right before creating anything — see its own doc comment for why order independence needs both).
 *
 * Pure and geometry-only, mirroring `reflow.ts`'s `planReflow`: it reads only along-wall ranges and returns a
 * plan to apply (or a reason it can't), never touching the API itself.
 */
export interface CornerAttachItem {
  readonly id: string;
  readonly start: number;
  readonly end: number;
}

export type CornerAttachPlan =
  | { readonly kind: "none" }
  | { readonly kind: "shift"; readonly deltaMm: number; readonly shifts: readonly { readonly id: string; readonly start: number }[] }
  | { readonly kind: "blocked"; readonly message: string };

const EPS = 1e-6;

/**
 * `leg.endAnchored` true: the leg is flush against the wall's far end (a "return leg") — the chain is pulled to
 * end exactly at `leg.start`. False: the leg is near the wall's start (a "front leg") — the chain is pushed to
 * start exactly at `leg.end`. Either way the whole chain moves by one uniform delta; blocked (nothing to apply)
 * only when that would push it past the wall's own bounds — never a silent overlap with the leg or the wall.
 */
export function packAgainstCorner(chain: readonly CornerAttachItem[], leg: { readonly start: number; readonly end: number; readonly endAnchored: boolean }, wallLengthMm: number): CornerAttachPlan {
  if (chain.length === 0) return { kind: "none" };
  const chainStart = Math.min(...chain.map((c) => c.start));
  const chainEnd = Math.max(...chain.map((c) => c.end));
  const deltaMm = leg.endAnchored ? leg.start - chainEnd : leg.end - chainStart;
  if (Math.abs(deltaMm) <= EPS) return { kind: "none" };
  const newStart = chainStart + deltaMm;
  const newEnd = chainEnd + deltaMm;
  if (newStart < -EPS || newEnd > wallLengthMm + EPS) {
    return {
      kind: "blocked",
      message: `The existing cabinets on this wall (${String(Math.round(chainEnd - chainStart))} mm) don't fit flush against the corner — they would need to sit at ${String(Math.round(newStart))}–${String(Math.round(newEnd))} mm on a ${String(Math.round(wallLengthMm))} mm wall. Move or resize them first.`,
    };
  }
  return { kind: "shift", deltaMm, shifts: chain.map((c) => ({ id: c.id, start: c.start + deltaMm })) };
}

/** True when shifting `chain` by `deltaMm` would overlap any `other` along-wall range not already part of the
 * chain (e.g. a second, unrelated corner leg further along the same wall) — a safety net `packAgainstCorner`
 * itself can't provide, since it only knows the one leg it's packing against. */
export function shiftedChainOverlaps(chain: readonly CornerAttachItem[], deltaMm: number, others: readonly CornerAttachItem[]): boolean {
  return chain.some((c) => {
    const start = c.start + deltaMm;
    const end = c.end + deltaMm;
    return others.some((o) => start < o.end - EPS && end > o.start + EPS);
  });
}
