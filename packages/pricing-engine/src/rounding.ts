import type { RoundingRule } from "@lintel/types";

/**
 * Round the non-negative rational `num / den` (paise) to a multiple of `rule.incrementPaise`
 * using `rule.mode`. Exact integer arithmetic.
 */
export function roundRational(num: bigint, den: bigint, rule: RoundingRule): bigint {
  if (num < 0n || den <= 0n) throw new RangeError("roundRational expects num ≥ 0, den > 0");
  const inc = BigInt(rule.incrementPaise);
  const d = den * inc;
  const q = num / d;
  const r = num % d;
  let units: bigint;
  switch (rule.mode) {
    case "DOWN":
      units = q;
      break;
    case "UP":
      units = r === 0n ? q : q + 1n;
      break;
    case "HALF_UP":
      units = 2n * r >= d ? q + 1n : q;
      break;
    case "HALF_EVEN":
      units = 2n * r > d ? q + 1n : 2n * r < d ? q : q % 2n === 0n ? q : q + 1n;
      break;
  }
  return units * inc;
}

export function isValidRoundingRule(rule: RoundingRule): boolean {
  return Number.isInteger(rule.incrementPaise) && rule.incrementPaise >= 1;
}
