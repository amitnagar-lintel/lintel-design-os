import { describe, expect, it } from "vitest";
import { arrangeRun, clampAlong, fit, footprintBox, inr, nearestWall, nextFreeX, placeOnWall, snapToNeighbors } from "../src/geometry.js";

describe("pilot UI layout helpers (user placement only)", () => {
  it("arranges a run edge to edge in the current left-to-right order and reports only the moves", () => {
    const items = [{ id: "b", x: 900, width: 750 }, { id: "a", x: 0, width: 600 }, { id: "c", x: 2000, width: 600 }];
    expect(arrangeRun(items)).toEqual([{ id: "b", x: 600 }, { id: "c", x: 1350 }]);
    expect(arrangeRun(items, 100)).toEqual([{ id: "a", x: 100 }, { id: "b", x: 700 }, { id: "c", x: 1450 }]);
    expect(arrangeRun([])).toEqual([]);
    expect(arrangeRun([{ id: "a", x: 0, width: 600 }, { id: "b", x: 600, width: 600 }])).toEqual([]);
  });
  it("finds the free end of the run, fits a plan into a box, formats paise", () => {
    expect(nextFreeX([])).toBe(0);
    expect(nextFreeX([{ id: "a", x: 0, width: 600 }, { id: "b", x: 600, width: 750 }])).toBe(1350);
    const f = fit(4200, 3200, 480, 400, 20);
    expect(f.scale).toBeCloseTo(440 / 4200);
    expect(f.ox).toBeCloseTo(20);
    expect(inr(3221500)).toBe("₹32,215.00");
    expect(inr(null)).toBe("—");
  });
});

describe("Slice 6A wall placement (mirrors geometry-engine's wallFrame/BACK_WALL)", () => {
  // KITCHEN room from tests/support/room.ts: 4200 (wall A) × 3200, matching the golden L-layout fixture.
  const L = 4200;
  const W = 3200;

  it("places a cabinet flush against each of the 4 walls at the correct origin and rotation", () => {
    expect(placeOnWall("A", 600, 0, L, W)).toEqual({ x: 600, z: 0, rotationY: 0 });
    expect(placeOnWall("B", 700, 30, L, W)).toEqual({ x: 4170, z: 700, rotationY: 270 });
    expect(placeOnWall("C", 500, 20, L, W)).toEqual({ x: 3700, z: 3180, rotationY: 180 });
    // The exact fixture in tests/support/room.ts: OBJ-KIT-004 (600 mm, rotationY 90) sits at x=0, z=1200 —
    // i.e. distance 0 (flush on wall D) and along 2000 (the L-layout's own comment: "spanning z 600…1200").
    expect(placeOnWall("D", 2000, 0, L, W)).toEqual({ x: 0, z: 1200, rotationY: 90 });
  });

  it("is the exact inverse of nearestWall for all 4 walls", () => {
    for (const [wallId, along, distance] of [["A", 600, 0], ["B", 700, 30], ["C", 500, 20], ["D", 2000, 0]] as const) {
      const { x, z } = placeOnWall(wallId, along, distance, L, W);
      expect(nearestWall(x, z, L, W)).toEqual({ wallId, along, distance });
    }
  });

  it("picks the nearest of the 4 walls for an arbitrary plan point", () => {
    expect(nearestWall(100, 50, L, W).wallId).toBe("A"); // z=50 is the smallest of the 4 candidate distances
    expect(nearestWall(4100, 1000, L, W).wallId).toBe("B");
    expect(nearestWall(1000, 3100, L, W).wallId).toBe("C");
    expect(nearestWall(80, 1500, L, W).wallId).toBe("D");
  });

  it("computes the footprint box for all 4 rotations, matching the golden L-layout fixture on wall D", () => {
    expect(footprintBox(600, 0, 0, 600, 560)).toEqual({ minX: 600, minZ: 0, sizeX: 600, sizeZ: 560 });
    // OBJ-KIT-004: x=0, z=1200, rotationY=90, width 600, depth 560 — footprint spans z ∈ [600, 1200] (the
    // fixture's own comment), clear of the depth-560 cabinets on wall A whose fronts reach z=560.
    expect(footprintBox(0, 1200, 90, 600, 560)).toEqual({ minX: 0, minZ: 600, sizeX: 560, sizeZ: 600 });
  });

  it("rounds its output to at most 2 decimals — the API's numeric(10,2) storage rejects more (see apps/api/src/common/http/measures.ts's Millimetres)", () => {
    const { x, z } = placeOnWall("A", 1234.567891, 0.001, L, W);
    expect(x).toBe(1234.57);
    expect(z).toBe(0);
    const b = placeOnWall("B", 700.005, 30.004999, L, W);
    expect(Number.isInteger(b.x * 100)).toBe(true);
    expect(Number.isInteger(b.z * 100)).toBe(true);
  });

  it("clamps an along-wall position so the footprint stays on the wall", () => {
    expect(clampAlong(-50, 600, 4200)).toBe(0);
    expect(clampAlong(4000, 600, 4200)).toBe(3600);
    expect(clampAlong(1000, 600, 4200)).toBe(1000);
    expect(clampAlong(100, 5000, 4200)).toBe(0); // a footprint wider than the wall clamps to its left end
  });
});

describe("Slice 6B cabinet-to-cabinet snap (snapToNeighbors)", () => {
  const neighbor600to1350 = [{ start: 600, end: 1350 }];

  it("snaps a dragged cabinet's start flush to a neighbour's right edge when within threshold", () => {
    expect(snapToNeighbors(1400, 600, neighbor600to1350)).toBe(1350); // 50 mm short, within default 150 mm threshold
    expect(snapToNeighbors(1350, 600, neighbor600to1350)).toBe(1350); // already exact
  });

  it("snaps a dragged cabinet's end flush to a neighbour's left edge when within threshold", () => {
    // A 600 mm cabinet whose end (along+600) is near the neighbour's start (600): along ≈ 0.
    expect(snapToNeighbors(50, 600, neighbor600to1350)).toBe(0);
  });

  it("does nothing beyond the snap threshold", () => {
    expect(snapToNeighbors(2000, 600, neighbor600to1350)).toBe(2000);
  });

  it("picks the closer of two candidate snaps", () => {
    const twoNeighbors = [{ start: 0, end: 590 }, { start: 1250, end: 1850 }];
    // A 600 mm cabinet at along=610 spans [610, 1210]: 20 mm short of the left neighbour's right edge (590),
    // and 40 mm short of the right neighbour's left edge (1250) — the left snap (590) is closer.
    expect(snapToNeighbors(610, 600, twoNeighbors)).toBe(590);
  });
});
