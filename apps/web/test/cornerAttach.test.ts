import { describe, expect, it } from "vitest";
import { packAgainstCorner, shiftedChainOverlaps } from "../src/cornerAttach.js";
import type { CornerAttachItem } from "../src/cornerAttach.js";

describe("packAgainstCorner (P1-1: run + corner continuity)", () => {
  it("does nothing when there is no existing chain, or it's already flush", () => {
    expect(packAgainstCorner([], { start: 3400, end: 4000, endAnchored: true }, 4000)).toEqual({ kind: "none" });
    const flush: CornerAttachItem[] = [{ id: "a", start: 2800, end: 3400 }];
    expect(packAgainstCorner(flush, { start: 3400, end: 4000, endAnchored: true }, 4000)).toEqual({ kind: "none" });
  });
  it("closes an accidental gap to an end-anchored (return leg) corner, shifting the whole chain by one delta", () => {
    // The post-P0 benchmark's exact case: 600+900+600+300 = 2400mm run built from 0, a 600mm corner leg flush
    // at the far end of a 4000mm wall (3400-4000) — 1000mm gap, closed by shifting the chain +1000.
    const chain: CornerAttachItem[] = [
      { id: "a", start: 0, end: 600 }, { id: "b", start: 600, end: 1500 }, { id: "c", start: 1500, end: 2100 }, { id: "d", start: 2100, end: 2400 },
    ];
    const plan = packAgainstCorner(chain, { start: 3400, end: 4000, endAnchored: true }, 4000);
    expect(plan).toEqual({ kind: "shift", deltaMm: 1000, shifts: [{ id: "a", start: 1000 }, { id: "b", start: 1600 }, { id: "c", start: 2500 }, { id: "d", start: 3100 }] });
  });
  it("preserves internal gaps within the chain — only removes the single outer gap to the corner", () => {
    const chain: CornerAttachItem[] = [{ id: "a", start: 0, end: 600 }, { id: "b", start: 650, end: 1250 }]; // 50mm internal gap
    const plan = packAgainstCorner(chain, { start: 2000, end: 2600, endAnchored: true }, 2600);
    expect(plan.kind).toBe("shift");
    const shifts = (plan as { shifts: readonly { id: string; start: number }[] }).shifts;
    expect(shifts[1]!.start - shifts[0]!.start).toBe(650); // gap unchanged
    expect(shifts[1]!.start).toBe(1400); // chain now ends exactly at 2000
  });
  it("pushes a chain out of the way of a near-end-anchored (front leg) corner, closing an overlap forward", () => {
    const chain: CornerAttachItem[] = [{ id: "a", start: 0, end: 600 }, { id: "b", start: 600, end: 1500 }];
    // A front leg starting at 560 (a typical carcass depth) would otherwise overlap the chain built from 0.
    const plan = packAgainstCorner(chain, { start: 560, end: 1160, endAnchored: false }, 4000);
    expect(plan).toEqual({ kind: "shift", deltaMm: 1160, shifts: [{ id: "a", start: 1160 }, { id: "b", start: 1760 }] });
  });
  it("is blocked (no shift returned) when the chain genuinely doesn't fit next to the corner", () => {
    const chain: CornerAttachItem[] = [{ id: "a", start: 0, end: 3000 }]; // 3000mm cabinet run
    const plan = packAgainstCorner(chain, { start: 3400, end: 4000, endAnchored: true }, 4000); // needs to start at 400, fits (400>=0) — make it not fit:
    expect(plan.kind).toBe("shift"); // sanity: this one DOES fit (400mm to spare)
    const tooLong: CornerAttachItem[] = [{ id: "a", start: 0, end: 3500 }];
    const blocked = packAgainstCorner(tooLong, { start: 3400, end: 4000, endAnchored: true }, 4000);
    expect(blocked.kind).toBe("blocked");
    expect((blocked as { message: string }).message).toMatch(/don't fit flush against the corner/);
  });
});

describe("shiftedChainOverlaps (P1-1 safety net: a second corner/object further along the same wall)", () => {
  it("detects an overlap the shift itself would introduce", () => {
    const chain: CornerAttachItem[] = [{ id: "a", start: 0, end: 600 }];
    expect(shiftedChainOverlaps(chain, 1000, [{ id: "other", start: 900, end: 1500 }])).toBe(true);
    expect(shiftedChainOverlaps(chain, 1000, [{ id: "other", start: 1600, end: 2000 }])).toBe(false);
  });
  it("touching (gap 0) is not an overlap", () => {
    const chain: CornerAttachItem[] = [{ id: "a", start: 0, end: 600 }];
    expect(shiftedChainOverlaps(chain, 1000, [{ id: "other", start: 1600, end: 2000 }])).toBe(false);
  });
});
