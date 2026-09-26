import { describe, expect, it } from "vitest";
import type { Box3 } from "@lintel/types";
import { FRONT_VIEW, hatch, projectBox, SECTION_VIEW_FROM_LEFT } from "../src/index.js";

const box: Box3 = { min: { x: 10, y: 0, z: 20 }, size: { x: 100, y: 50, z: 30 } };

describe("view framework", () => {
  it("front view maps X right, Y up, depth = front face (+Z)", () => {
    expect(projectBox("b", box, FRONT_VIEW)).toEqual({ id: "b", x0: 10, x1: 110, y0: 0, y1: 50, z: 50 });
  });
  it("section-from-left maps Z right and depth = −X (nearest face is the smallest X)", () => {
    expect(projectBox("b", box, SECTION_VIEW_FROM_LEFT)).toEqual({ id: "b", x0: 20, x1: 50, y0: 0, y1: 50, z: -10 });
  });
  it("negative axes flip ranges", () => {
    expect(projectBox("b", box, { name: "T", right: "-Z", up: "+Y", toward: "+X" })).toEqual({ id: "b", x0: -50, x1: -20, y0: 0, y1: 50, z: 110 });
  });
});

describe("hatch", () => {
  it("fills a rectangle with 45° lines clipped to it", () => {
    const lines = hatch(0, 0, 10, 4, 2);
    expect(lines.length).toBeGreaterThan(0);
    for (const [ax, ay, bx, by] of lines) {
      for (const [x, y] of [
        [ax, ay],
        [bx, by],
      ] as const) {
        expect(x).toBeGreaterThanOrEqual(-1e-9);
        expect(x).toBeLessThanOrEqual(10 + 1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
        expect(y).toBeLessThanOrEqual(4 + 1e-9);
      }
      expect(bx - ax).toBeCloseTo(by - ay, 9);
    }
  });
  it("is empty for degenerate rectangles", () => {
    expect(hatch(0, 0, 0, 5)).toEqual([]);
  });
});
