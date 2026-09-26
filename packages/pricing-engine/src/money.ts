/**
 * Exact money arithmetic in integer paise. Intermediate products use BigInt so no
 * floating-point error can reach an amount. Rounding: half up (amounts are non-negative).
 */

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

const isNearInteger = (v: number): boolean => Math.abs(v - Math.round(v)) < 1e-7;

/** INR with at most 2 decimals → integer paise. */
export function inrToPaise(inr: number): bigint {
  const p = inr * 100;
  if (!Number.isFinite(inr) || inr < 0 || !isNearInteger(p)) throw new MoneyError(`Rate ${inr} must be a non-negative INR amount with at most 2 decimals`);
  return BigInt(Math.round(p));
}

/** Percent with at most 2 decimals → integer basis points. */
export function percentToBasisPoints(percent: number): bigint {
  const bp = percent * 100;
  if (!Number.isFinite(percent) || percent < 0 || !isNearInteger(bp)) throw new MoneyError(`Percentage ${percent} must be non-negative with at most 2 decimals`);
  return BigInt(Math.round(bp));
}

/** Quantity with at most 6 decimals → integer micro-units. */
export function quantityToMicro(quantity: number): bigint {
  const m = quantity * 1e6;
  if (!Number.isFinite(quantity) || quantity < 0 || !isNearInteger(m)) throw new MoneyError(`Quantity ${quantity} must be non-negative with at most 6 decimals`);
  return BigInt(Math.round(m));
}

/** round(a / b) half up, for a ≥ 0, b > 0. */
export function roundDiv(a: bigint, b: bigint): bigint {
  return (2n * a + b) / (2n * b);
}

/** quantity × rate(INR) → paise. */
export function amountFor(quantity: number, rateInr: number): bigint {
  return roundDiv(quantityToMicro(quantity) * inrToPaise(rateInr), 1_000_000n);
}

/** paise × percent → paise. */
export function percentOf(paise: bigint, percent: number): bigint {
  return roundDiv(paise * percentToBasisPoints(percent), 10_000n);
}

/** Convert to a JS number, refusing anything that would lose precision. */
export function toSafeNumber(v: bigint): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new MoneyError(`Amount ${v} exceeds safe integer range`);
  return Number(v);
}
