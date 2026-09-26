import type { QuotationPolicy } from "@lintel/types";

/**
 * PRODUCTION quotation policy — NOT YET DEFINED. GST rates, tax policy, rounding and
 * discount policy are NULL / UNVERIFIED until Lintel finance / tax review approves them.
 * No legacy discount or tax rule has been ported.
 */
export const LINTEL_PRODUCTION_QUOTATION_POLICY: QuotationPolicy = {
  policyId: "LINTEL_PRODUCTION_QUOTATION_POLICY",
  version: "0.1.0",
  status: "DRAFT",
  classification: "PRODUCTION",
  source: "Pending — Lintel finance / tax review",
  taxRates: {},
  taxRateByProductCategory: { KITCHEN_BASE: null },
  taxPolicy: null,
  rounding: { tax: null, grandTotal: null },
  discountPolicy: null,
};
