# ADR-0004 — Construction values come from a versioned ConstructionStandard; unknowns block, never default

Status: **Accepted** (2026-09-26)

## Context
CLAUDE.md: do not invent construction dimensions; where a value is unknown, create a configurable
rule rather than inventing a value. The PRD defines the reference cabinet (600 × 720 × 560, 18/6 mm,
1 shelf, 2 overlay shutters) but not reveals, groove depth, rail width, setbacks, edge rules, etc.

## Decision
- Recipes reference such values only by **named construction variables** (declared in the recipe).
- Values are supplied by a `ConstructionStandard` (versioned, with `status`).
- `LINTEL_CONSTRUCTION_STANDARD` (v0.2.0 since `SHUTTER_BACK_GAP` was added) is **DRAFT with every value `null`**. The engine generates only
  components fully defined by known values and reports each missing value as a
  `CONSTRUCTION_VARIABLE_UNDEFINED` BLOCKER (the list production must fill in: `docs/catalog/KIT_BASE_STANDARD.md`).
- `TEST_FIXTURE_CONSTRUCTION_STANDARD` holds **synthetic** values to exercise mechanics in tests. Any
  standard not `APPROVED` produces a BLOCKER, so fixture values can never reach production.
- Product, recipe and hardware rule set status other than `APPROVED` also BLOCK approval; unverified
  materials/finishes/edge bands produce WARNINGs.

## Consequences
The production golden fixture is intentionally "mostly blocked" until Lintel approves a standard.
Changing any construction value is a data change (new standard version), not a code change.
