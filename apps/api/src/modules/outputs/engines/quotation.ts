/**
 * Entry module of the `quotation` output engine: quoteRoom (always PRODUCTION mode) from the resolved room model, an
 * exact stored room BOQ and room pricing (consumed, never re-priced) and the explicitly chosen QuotationPolicy
 * version. Every financial rule (tax, grouping, rounding, totals) is the engine's; nothing is decided here.
 */
import type { QuotationPolicyRows } from "@lintel/persistence";
import { quotationPolicyFromRows } from "@lintel/persistence";
import type { QuotationResult } from "@lintel/pricing-engine";
import { quoteRoom } from "@lintel/pricing-engine";
import type { CatalogSnapshot, ResolvedRoom, RoomBOQ, RoomPriceSnapshot } from "@lintel/types";

export { engineeringModel, resolveEngineeringModel } from "./validation.js";

export function roomQuotation(input: {
  readonly resolved: ResolvedRoom; readonly catalog: CatalogSnapshot; readonly boq: RoomBOQ; readonly pricing: RoomPriceSnapshot;
  readonly quotationPolicy: QuotationPolicyRows; readonly revision: string; readonly createdAt: string;
}): QuotationResult {
  const policy = quotationPolicyFromRows(input.quotationPolicy).value;
  return quoteRoom({ mode: "PRODUCTION", room: input.resolved, roomBoq: input.boq, pricing: input.pricing, policy, catalog: input.catalog, revision: input.revision, createdAt: input.createdAt });
}
