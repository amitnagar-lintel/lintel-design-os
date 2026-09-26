import type { QuotationPolicy } from "@lintel/types";

/**
 * TEST FIXTURE — synthetic quotation policy for engine tests only. Quotation-level tax
 * after aggregation by tax rate (PER_RATE_GROUP). NOT a Lintel finance or tax position.
 */
export const TEST_FIXTURE_QUOTATION_POLICY: QuotationPolicy = {
  policyId: "TEST_FIXTURE_QUOTATION_POLICY",
  version: "0.0.1",
  status: "TEST_FIXTURE",
  classification: "TEST_FIXTURE",
  source: "Test fixture (synthetic)",
  taxRates: { TEST_RATE_18: 18 },
  taxRateByProductCategory: { KITCHEN_BASE: "TEST_RATE_18" },
  taxPolicy: "PER_RATE_GROUP",
  rounding: { tax: { mode: "HALF_UP", incrementPaise: 1 }, grandTotal: { mode: "HALF_UP", incrementPaise: 100 } },
  discountPolicy: { mode: "NONE" },
};
