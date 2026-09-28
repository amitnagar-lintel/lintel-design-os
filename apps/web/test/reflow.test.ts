import { describe, expect, it } from "vitest";
import { planReflow } from "../src/reflow.js";
import type { ReflowInput, ReflowObject } from "../src/reflow.js";

const obj = (id: string, code: string, start: number, end: number): [string, ReflowObject] => [
  id,
  { objectId: `obj_${id}`, objectCode: code, alongWall: { start, end }, distanceToWall: 0, yMm: 0 },
];

/** 600 + 900 + 600 run on wall A (0-2100mm), touching, in a 3600mm-long wall — the acceptance test's own layout. */
function baseInput(): ReflowInput {
  return {
    runLineageIds: ["a", "b", "c"],
    wallId: "A",
    wallLength: 3600,
    cornerLineageIds: new Set(),
    objectsByLineageId: new Map([obj("a", "BC-001", 0, 600), obj("b", "BC-002", 600, 1500), obj("c", "BC-003", 1500, 2100)]),
  };
}

describe("planReflow (hardening P0-3: resize/neighbour reflow)", () => {
  it("does nothing when the width didn't change", () => {
    expect(planReflow(baseInput(), "b", 0)).toEqual({ kind: "none" });
  });
  it("does nothing when the resized cabinet isn't in a run (or is the run's last member)", () => {
    expect(planReflow(baseInput(), "x", 100)).toEqual({ kind: "none" });
    expect(planReflow(baseInput(), "c", 100)).toEqual({ kind: "none" });
  });
  it("shrinking the middle cabinet (900→750, delta -150) shifts only the cabinet(s) after it, preserving their gap", () => {
    const plan = planReflow(baseInput(), "b", -150);
    expect(plan).toEqual({ kind: "shift", shifts: [{ objectId: "obj_c", along: 1350, distanceToWall: 0, yMm: 0 }] });
  });
  it("growing the middle cabinet shifts the following cabinet the same amount, even if that's the run's last member", () => {
    const plan = planReflow(baseInput(), "b", 300);
    expect(plan).toEqual({ kind: "shift", shifts: [{ objectId: "obj_c", along: 1800, distanceToWall: 0, yMm: 0 }] });
  });
  it("refuses (no shift produced) when the shift would push a cabinet past the end of the wall", () => {
    const plan = planReflow(baseInput(), "b", 2000); // BC-003 would end at 4100mm > 3600mm wall length
    expect(plan.kind).toBe("blocked");
    expect((plan as { message: string }).message).toMatch(/BC-003/);
    expect((plan as { message: string }).message).toMatch(/outside wall A/);
  });
  it("P1-3: shrinking a cabinet immediately before a downstream corner leg succeeds — the leg never moves, but shrinking only ever needs less space", () => {
    const input: ReflowInput = { ...baseInput(), cornerLineageIds: new Set(["c"]) };
    expect(planReflow(input, "b", -150)).toEqual({ kind: "none" }); // b(600-1500) shrinks to 600-1350; c(1500-2100, the corner leg) stays put, untouched, no overlap
  });
  it("P1-3: growing a cabinet into a downstream corner leg's fixed position is refused, corner-specific message", () => {
    const input: ReflowInput = { ...baseInput(), cornerLineageIds: new Set(["c"]) };
    const plan = planReflow(input, "b", 700); // b would end at 2200, past c's fixed start at 1500
    expect(plan.kind).toBe("blocked");
    expect((plan as { message: string }).message).toMatch(/BC-002/);
    expect((plan as { message: string }).message).toMatch(/BC-003 corner cabinet/);
  });
  it("P1-3: growing into slack that already exists before the downstream corner leg succeeds (no shift needed — nothing between them)", () => {
    // Same layout, but with the corner leg (BC-003) sitting 50mm further along the wall than b's own end — a
    // pre-existing gap the resize can grow into without touching the leg's fixed position at all.
    const input: ReflowInput = {
      ...baseInput(),
      cornerLineageIds: new Set(["c"]),
      objectsByLineageId: new Map([obj("a", "BC-001", 0, 600), obj("b", "BC-002", 600, 1500), obj("c", "BC-003", 1550, 2150)]),
    };
    expect(planReflow(input, "b", 50)).toEqual({ kind: "none" }); // b now ends exactly at 1550, flush with the still-untouched corner leg
  });
  it("P1-3: an ordinary cabinet BETWEEN the resized one and the corner leg still shifts normally", () => {
    // a(0-600) b(600-1500,900) c(1500-2100,600) d(2100-2700,600, corner leg). Resize a; b and c must shift, d never does.
    const input: ReflowInput = {
      runLineageIds: ["a", "b", "c", "d"], wallId: "A", wallLength: 4000, cornerLineageIds: new Set(["d"]),
      objectsByLineageId: new Map([obj("a", "BC-001", 0, 600), obj("b", "BC-002", 600, 1500), obj("c", "BC-003", 1500, 2100), obj("d", "BC-004", 2100, 2700)]),
    };
    const plan = planReflow(input, "a", -150);
    expect(plan).toEqual({ kind: "shift", shifts: [{ objectId: "obj_b", along: 450, distanceToWall: 0, yMm: 0 }, { objectId: "obj_c", along: 1350, distanceToWall: 0, yMm: 0 }] });
  });
  it("preserves a pre-existing gap (not just a touching run) when shifting", () => {
    const input: ReflowInput = {
      ...baseInput(),
      objectsByLineageId: new Map([obj("a", "BC-001", 0, 600), obj("b", "BC-002", 600, 1500), obj("c", "BC-003", 1520, 2120)]), // 20mm gap before c
    };
    const plan = planReflow(input, "b", -150);
    expect(plan).toEqual({ kind: "shift", shifts: [{ objectId: "obj_c", along: 1370, distanceToWall: 0, yMm: 0 }] }); // gap still 20mm: 1370 - 1350
  });
});
