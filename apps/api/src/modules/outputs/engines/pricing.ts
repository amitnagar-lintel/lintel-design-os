/**
 * Entry module of the `pricing` output engine: room pricing (priceRoom, always PRODUCTION mode) from the resolved
 * room model, exact stored room BOM / BOQ and the explicitly chosen PricingStandard version (mapped by
 * @lintel/persistence; NULL rates and rules stay NULL and make the result UNAVAILABLE — nothing is invented).
 */
import type { PricingStandardRows } from "@lintel/persistence";
import { pricingStandardFromRows } from "@lintel/persistence";
import type { RoomPricingResult } from "@lintel/pricing-engine";
import { priceRoom } from "@lintel/pricing-engine";
import type { ResolvedRoom, RoomBOM, RoomBOQ } from "@lintel/types";

export { engineeringModel, resolveEngineeringModel } from "./validation.js";

export function roomPricing(input: { readonly resolved: ResolvedRoom; readonly bom: RoomBOM; readonly boq: RoomBOQ; readonly pricingStandard: PricingStandardRows; readonly createdAt: string }): RoomPricingResult {
  const { rateCard, rules } = pricingStandardFromRows(input.pricingStandard).value;
  return priceRoom({ mode: "PRODUCTION", room: input.resolved, roomBom: input.bom, roomBoq: input.boq, rateCard, rules, createdAt: input.createdAt });
}
