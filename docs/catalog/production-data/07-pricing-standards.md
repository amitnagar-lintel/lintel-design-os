# 07 — Pricing standards

Data sets: `LINTEL_PRODUCTION_RATE_CARD` and `LINTEL_PRODUCTION_PRICING_RULES`
(`packages/pricing-engine/src/data/production.ts`) — v0.1.0, `DRAFT`, every value `null`.
Production pricing returns `UNAVAILABLE` until both are `APPROVED` **and** the design itself has no
blockers (construction standard, Hettich data and catalog approved).

The legacy ops `rate_library` is not a source for these values: it holds composite per-sq-ft selling
rates, not unit costs, and has not been approved for Design OS.

## Rate card (INR, at most 2 decimals)
| Item | Unit | Rate | Status | Source / supplier | Approved by / date |
|---|---|---|---|---|---|
| BOARD_BWP_18 | per m² net area | NULL | NULL / UNVERIFIED | — | — |
| BOARD_HDHMR_18 | per m² net area | NULL | NULL / UNVERIFIED | — | — |
| BOARD_BACK_6 | per m² net area | NULL | NULL / UNVERIFIED | — | — |
| EDGE_ABS_2MM | per m | NULL | NULL / UNVERIFIED | — | — |
| EDGE_ABS_0_8MM | per m | NULL | NULL / UNVERIFIED | — | — |
| LAMINATE_WHITE | per m² finished face | NULL | NULL / UNVERIFIED | — | — |
| Hettich articles | per unit | NULL — no verified articles exist yet (see 04) | NULL / UNVERIFIED | — | — |
| Rate card effective-from date | date | NULL | NULL / UNVERIFIED | — | — |

## Pricing rules (percentages at most 2 decimals)
| Field | Unit | Value | Status | Approved by / date |
|---|---|---|---|---|
| Manufacturing cost formula (over PANEL_COUNT, BOARD_AREA_M2, EDGE_LENGTH_M, FINISH_AREA_M2, HARDWARE_UNITS) | INR | NULL | NULL / UNVERIFIED | — |
| Board wastage | % | NULL | NULL / UNVERIFIED | — |
| Edge-band wastage | % | NULL | NULL / UNVERIFIED | — |
| Finish wastage | % | NULL | NULL / UNVERIFIED | — |
| Overhead | % of direct cost | NULL | NULL / UNVERIFIED | — |
| Margin basis (MARKUP_ON_COST / MARGIN_ON_PRICE) | — | NULL | NULL / UNVERIFIED | — |
| Margin | % | NULL | NULL / UNVERIFIED | — |
| GST rate applicable to this product | % | NULL | NULL / UNVERIFIED (finance / tax adviser) | — |
| Transport (PRD §23) | — | NULL | NULL / UNVERIFIED — not modelled in M2 | — |
| Installation (PRD §23) | — | NULL | NULL / UNVERIFIED — not modelled in M2 | — |

## Quotation / tax policy (finance and tax review)
Data set: `LINTEL_PRODUCTION_QUOTATION_POLICY` (`packages/pricing-engine/src/data/quotation-policy.ts`) —
v0.1.0, `DRAFT`, every field `null`. Flow: line taxable amounts → grouped by applicable tax rate → tax per the
tax policy → configured rounding → quotation totals. No legacy discount or tax rule has been ported.

| Field | Options | Value | Status | Approved by / date |
|---|---|---|---|---|
| GST rate(s) (rate id → %) | percent, ≤ 2 decimals | NULL | NULL / UNVERIFIED (finance / tax adviser) | — |
| Tax rate by product category (KITCHEN_BASE → rate id) | rate id | NULL | NULL / UNVERIFIED | — |
| Tax policy | `PER_LINE` (tax rounded per line) / `PER_RATE_GROUP` (tax on each rate group's total) | NULL | NULL / UNVERIFIED | — |
| Tax rounding | mode `HALF_UP` / `HALF_EVEN` / `DOWN` / `UP`; increment in paise | NULL | NULL / UNVERIFIED | — |
| Grand-total rounding | mode and increment (e.g. to whole rupees) | NULL | NULL / UNVERIFIED | — |
| Discount policy | only `NONE` exists in M4; any other mode requires finance approval before it is built | NULL | NULL / UNVERIFIED | — |

The GST percentage in the pricing rules and the quotation policy's rate for the same product must agree
(`QUOTATION_TAX_RATE_CONFLICT` otherwise). The TEST_FIXTURE policy uses `PER_RATE_GROUP` with synthetic values.
