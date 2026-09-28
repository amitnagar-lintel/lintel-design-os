/** Remediation (Slice 6F follow-up, hardening): the authoritative backend range check for cabinet dimensions. */
import { describe, expect, it } from "vitest";
import { dimensionFieldErrors } from "../../src/modules/design-versions/dimension-limits.js";

const NONE = { min: null, max: null };
const dims = (widthMm: number) => ({ widthMm, heightMm: 720, depthMm: 560 });

describe("dimensionFieldErrors", () => {
  it("reports nothing when no limit is declared at all", () => {
    expect(dimensionFieldErrors(dims(5000), { width: NONE, height: NONE, depth: NONE })).toEqual([]);
  });
  it("rejects a width below the declared minimum, and reports the exact field path/message", () => {
    const errors = dimensionFieldErrors(dims(10), { width: { min: 20, max: 300 }, height: NONE, depth: NONE });
    expect(errors).toEqual([{ path: "body.dimensions.widthMm", code: "out_of_range", message: "must be at least 20 mm (got 10)" }]);
  });
  it("rejects a width above the declared maximum", () => {
    const errors = dimensionFieldErrors(dims(600), { width: { min: 20, max: 300 }, height: NONE, depth: NONE });
    expect(errors).toEqual([{ path: "body.dimensions.widthMm", code: "out_of_range", message: "must be at most 300 mm (got 600)" }]);
  });
  it("accepts a width within (and at) the declared bounds", () => {
    expect(dimensionFieldErrors(dims(20), { width: { min: 20, max: 300 }, height: NONE, depth: NONE })).toEqual([]);
    expect(dimensionFieldErrors(dims(300), { width: { min: 20, max: 300 }, height: NONE, depth: NONE })).toEqual([]);
    expect(dimensionFieldErrors(dims(150), { width: { min: 20, max: 300 }, height: NONE, depth: NONE })).toEqual([]);
  });
  it("checks every dimension independently and reports all violations at once", () => {
    const errors = dimensionFieldErrors(
      { widthMm: 10, heightMm: 5000, depthMm: 560 },
      { width: { min: 20, max: 300 }, height: { min: 500, max: 900 }, depth: NONE },
    );
    expect(errors.map((e) => e.path)).toEqual(["body.dimensions.widthMm", "body.dimensions.heightMm"]);
  });
});
