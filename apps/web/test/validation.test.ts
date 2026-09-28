import { describe, expect, it } from "vitest";
import { dimensionError } from "../src/validation.js";

describe("dimensionError (Slice 6F remediation P0: reject an out-of-range dimension before Save)", () => {
  it("passes when there is no declared limit at all", () => {
    expect(dimensionError("Width", 5000, undefined)).toBeNull();
    expect(dimensionError("Width", 5000, { min: null, max: null })).toBeNull();
  });
  it("rejects below the minimum and above the maximum", () => {
    expect(dimensionError("Width", 10, { min: 20, max: 300 })).toBe("Width must be at least 20 mm (got 10)");
    expect(dimensionError("Width", 600, { min: 20, max: 300 })).toBe("Width must be at most 300 mm (got 600)");
  });
  it("passes within (and at) the declared bounds", () => {
    expect(dimensionError("Width", 20, { min: 20, max: 300 })).toBeNull();
    expect(dimensionError("Width", 300, { min: 20, max: 300 })).toBeNull();
    expect(dimensionError("Width", 150, { min: 20, max: 300 })).toBeNull();
  });
  it("rejects a non-finite value regardless of limits", () => {
    expect(dimensionError("Width", Number.NaN, { min: 20, max: 300 })).toBe("Width must be a number");
    expect(dimensionError("Width", Number.NaN, undefined)).toBe("Width must be a number");
  });
});
