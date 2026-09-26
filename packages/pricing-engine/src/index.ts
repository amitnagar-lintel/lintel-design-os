export { MANUFACTURING_VARIABLES, PRICING_ENGINE_VERSION, isPriceStale, priceCabinet, verifyPriceSnapshot } from "./price.js";
export type { PriceCabinetInput } from "./price.js";
export { amountFor, inrToPaise, MoneyError, percentOf, percentToBasisPoints, quantityToMicro, roundDiv, toSafeNumber } from "./money.js";
export { LINTEL_PRODUCTION_PRICING_RULES, LINTEL_PRODUCTION_RATE_CARD } from "./data/production.js";
export { TEST_FIXTURE_PRICING_RULES, TEST_FIXTURE_RATE_CARD } from "./fixtures/test-pricing.js";

/** Format paise as an INR string (en-IN grouping, 2 decimals). Presentation only. */
export function formatInr(paise: number): string {
  const rupees = Math.trunc(paise / 100);
  const p = Math.abs(paise % 100);
  return `₹${rupees.toLocaleString("en-IN")}.${String(p).padStart(2, "0")}`;
}
