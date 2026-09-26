import { describe, expect, it } from "vitest";
import { ascii, fmt, projectEdges } from "../src/index.js";
import type { Rect2 } from "../src/index.js";

const r = (id: string, x0: number, y0: number, x1: number, y1: number, z: number): Rect2 => ({ id, x0, y0, x1, y1, z });

describe("projectEdges — exact hidden-line removal", () => {
  it("draws a lone panel fully visible", () => {
    const segs = projectEdges([r("a", 0, 0, 10, 20, 5)]);
    expect(segs).toHaveLength(4);
    expect(segs.every((s) => !s.hidden)).toBe(true);
  });
  it("hides the covered parts of a panel behind a nearer one", () => {
    const back = r("back", 0, 0, 100, 100, 10);
    const front = r("front", 20, 20, 80, 80, 20);
    const segs = projectEdges([back, front]);
    expect(segs.filter((s) => s.hidden)).toEqual([]); // back's outline is outside the front panel
    const inner = r("inner", 30, 30, 70, 70, 5);
    const withInner = projectEdges([back, front, inner]);
    expect(withInner.filter((s) => s.hidden)).toHaveLength(4); // inner panel entirely hidden → dashed
  });
  it("splits an edge into visible and hidden intervals", () => {
    const shelf = r("shelf", 0, 50, 100, 60, 5);
    const door = r("door", 0, 0, 40, 100, 20);
    const top = projectEdges([shelf, door]).filter((s) => s.y1 === 60 && s.y2 === 60);
    expect(top).toEqual([
      { x1: 40, y1: 60, x2: 100, y2: 60, hidden: false },
      { x1: 0, y1: 60, x2: 40, y2: 60, hidden: true },
    ]);
  });
  it("keeps edges lying on an occluder boundary visible and merges coincident edges", () => {
    const a = r("a", 0, 0, 10, 10, 5);
    const b = r("b", 10, 0, 20, 10, 20);
    const shared = projectEdges([a, b]).filter((s) => s.x1 === 10 && s.x2 === 10);
    expect(shared).toEqual([{ x1: 10, y1: 0, x2: 10, y2: 10, hidden: false }]);
  });
  it("is deterministic and order-independent", () => {
    const rects = [r("a", 0, 0, 100, 100, 10), r("b", 20, 20, 80, 80, 20), r("c", 0, 50, 100, 60, 5)];
    expect(projectEdges(rects)).toEqual(projectEdges([...rects].reverse()));
  });
});

describe("format", () => {
  it("formats numbers without locale and trims zeros", () => {
    expect(fmt(600)).toBe("600");
    expect(fmt(296.5)).toBe("296.5");
    expect(fmt(1.005, 2)).toBe("1");
    expect(fmt(-0.0001)).toBe("0");
  });
  it("forces ASCII text", () => {
    expect(ascii("297 × 717 — ok ₹")).toBe("297 x 717 - ok INR ");
    expect(ascii("Ω")).toBe("?");
  });
});
