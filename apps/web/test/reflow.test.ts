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
  it("refuses when a cabinet that would need to shift is a corner leg", () => {
    const input: ReflowInput = { ...baseInput(), cornerLineageIds: new Set(["c"]) };
    const plan = planReflow(input, "b", 100);
    expect(plan.kind).toBe("blocked");
    expect((plan as { message: string }).message).toMatch(/BC-003/);
    expect((plan as { message: string }).message).toMatch(/corner/);
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
