import { describe, expect, it } from "vitest";
import { arrangeRun, fit, inr, nextFreeX } from "../src/geometry.js";

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
