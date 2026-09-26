# ADR-0006 — Pricing engine, immutable price snapshots, TEST_FIXTURE vs PRODUCTION classification

Status: **Accepted** (2026-09-26, M2)

## Decision
- `@lintel/pricing-engine` prices a resolved cabinet from its BOM + BOQ (PRD §23):
  material (board + edge band) + finish + hardware + manufacturing + wastage = direct cost;
  + overhead = total cost; + margin = selling price ex GST; + GST = selling price inc GST.
- Money is integer **paise**; intermediate products use BigInt; rounding is half up per line.
  Rates must have ≤ 2 decimals, percentages ≤ 2 decimals (exact basis points), quantities ≤ 6 decimals.
- Rates (`RateCard`) and rules (`PricingRuleSet`) are versioned data. Manufacturing cost is a data-driven
  formula over BOM measures. No price or rate exists in geometry or design code.
- The result is either an immutable `PriceSnapshot` (deep-frozen, embeds full copies of the rate card and
  rules, sealed with a content hash, carries the model fingerprint for staleness) or `UNAVAILABLE` with every
  blocker. Nothing is ever priced at zero: missing / NULL rates, incomplete BOMs and unresolved hardware refuse.
- Every data set and trace carries a `DataClassification`: `PRODUCTION` or `TEST_FIXTURE`.
  - Pricing refuses data whose classification differs from the requested mode (no substitution either way).
  - PRODUCTION pricing additionally requires an APPROVED rate card and rules, a PRODUCTION-classified design
    trace and a design with zero blockers — i.e. the production catalog must be approved first.
  - The production rate card and rules ship as DRAFT with every value `null`.
- The design engine classifies each result: any fixture input (standard, hardware dataset, product, recipe,
  material) makes the trace `TEST_FIXTURE` and adds a `TEST_FIXTURE_DATA_IN_USE` BLOCKER.
- Hettich data is split into `HettichProductionDataset` (source-verified `HettichProductionRecord`s, validated
  field by field; unverified records are excluded) and `HettichFixtureDataset` (`FIXTURE-*` only).

## Consequences
The reference cabinet can be priced end-to-end only under TEST_FIXTURE. Production pricing becomes available
automatically once approved production data is encoded — without code changes.
