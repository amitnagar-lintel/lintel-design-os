import { describe, expect, it } from "vitest";
import { roundRational } from "../src/index.js";

describe("roundRational", () => {
  const r = (num: bigint, den: bigint, mode: "HALF_UP" | "HALF_EVEN" | "DOWN" | "UP", inc = 1) => roundRational(num, den, { mode, incrementPaise: inc });
  it("rounds to paise with each mode", () => {
    expect([r(25n, 10n, "HALF_UP"), r(25n, 10n, "HALF_EVEN"), r(35n, 10n, "HALF_EVEN"), r(21n, 10n, "UP"), r(29n, 10n, "DOWN")]).toEqual([3n, 2n, 4n, 3n, 2n]);
  });
  it("rounds to whole rupees (100 paise)", () => {
    expect(r(1036549n, 1n, "HALF_UP", 100)).toBe(1036500n);
    expect(r(1036550n, 1n, "HALF_UP", 100)).toBe(1036600n);
    expect(r(1036550n, 1n, "HALF_EVEN", 100)).toBe(1036600n);
    expect(r(1036450n, 1n, "HALF_EVEN", 100)).toBe(1036400n);
    expect(r(1036401n, 1n, "UP", 100)).toBe(1036500n);
  });
  it("rejects negative input", () => {
    expect(() => r(-1n, 1n, "HALF_UP")).toThrow(RangeError);
  });
});
