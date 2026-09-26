import { describe, expect, it } from "vitest";
import { amountFor, formatInr, inrToPaise, MoneyError, percentOf, percentToBasisPoints, quantityToMicro, roundDiv, toSafeNumber } from "../src/index.js";

describe("exact money arithmetic", () => {
  it("converts INR with ≤ 2 decimals to paise and rejects anything else", () => {
    expect(inrToPaise(1000)).toBe(100000n);
    expect(inrToPaise(12.34)).toBe(1234n);
    expect(inrToPaise(0.1 + 0.2)).toBe(30n); // float noise tolerated, value is exact 0.30
    expect(() => inrToPaise(1.005)).toThrow(MoneyError);
    expect(() => inrToPaise(-1)).toThrow(MoneyError);
    expect(() => inrToPaise(Number.NaN)).toThrow(MoneyError);
  });
  it("converts percentages to basis points and quantities to micro-units", () => {
    expect(percentToBasisPoints(12.5)).toBe(1250n);
    expect(() => percentToBasisPoints(12.345)).toThrow(MoneyError);
    expect(quantityToMicro(1.526156)).toBe(1526156n);
    expect(() => quantityToMicro(1.0000001)).toThrow(MoneyError);
  });
  it("rounds half up", () => {
    expect(roundDiv(5n, 2n)).toBe(3n);
    expect(roundDiv(4n, 2n)).toBe(2n);
    expect(roundDiv(1n, 3n)).toBe(0n);
    expect(amountFor(1.526156, 1000)).toBe(152616n); // 152615.6
    expect(amountFor(0.425898, 900)).toBe(38331n); // 38330.82
    expect(percentOf(20741n * 10n + 9n, 10)).toBe(20742n); // 20741.9
    expect(percentOf(597323n, 0)).toBe(0n);
  });
  it("refuses unsafe integers", () => {
    expect(() => toSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(MoneyError);
  });
  it("formats INR for display", () => {
    expect(formatInr(1036531)).toBe("₹10,365.31");
    expect(formatInr(5)).toBe("₹0.05");
  });
});
