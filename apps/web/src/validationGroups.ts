/**
 * P1-4 (validation signal cleanup): the underlying severities (BLOCKER/ERROR/WARNING/INFO) and every one of the
 * engine's own message codes (`packages/design-engine`, `packages/catalog-engine`, `packages/rules-engine`) are
 * completely untouched by this module — including `STANDARD_UNKNOWN_VARIABLE`, which is never removed, weakened
 * or hidden. This only classifies each message for DISPLAY, so a designer can tell "something about the placed
 * cabinets is wrong" (Design issues) apart from "the reference catalog/construction standard itself is
 * incomplete" (Reference/data health) — the two very different kinds of "94 ERROR" the post-P0 benchmark found
 * indistinguishable in the Validation panel.
 */
export type ValidationGroup = "DESIGN" | "REFERENCE_DATA";

/** Codes about the reference/construction-standard data itself (an incomplete catalog, standard or recipe) —
 * never about a designer's own placement, run, corner, sizing or cabinet choice. Whitelisted explicitly, so a
 * code this list doesn't yet know about defaults to "DESIGN" below: a real design problem must never be
 * silently buried in the reference-data bucket just because its code is unrecognised. */
const REFERENCE_DATA_CODES: ReadonlySet<string> = new Set([
  // Construction standard / recipe declarations (the exact code the post-P0 benchmark's 94 errors were).
  "STANDARD_UNKNOWN_VARIABLE",
  "CONSTRUCTION_VARIABLE_UNDEFINED",
  // Catalog authoring/consistency (would be caught at catalog-approval time in a complete standard).
  "CATALOG_UNKNOWN_VARIABLE",
  "CATALOG_FORMULA_PARSE_ERROR",
  "CATALOG_FORMULA_VARIABLES_MISMATCH",
  "CATALOG_INVALID_GRAIN",
  "CATALOG_UNKNOWN_REFERENCE",
  "CATALOG_DUPLICATE_ID",
  "CATALOG_ITEM_NOT_APPROVED",
  "CATALOG_REFERENCE_MISSING",
  // Material/finish/hardware/edge-band reference resolution.
  "MATERIAL_UNKNOWN",
  "FINISH_UNKNOWN",
  "MATERIAL_GRAIN_UNDEFINED",
  "COMPONENT_MATERIAL_UNRESOLVED",
  "COMPONENT_THICKNESS_MATERIAL_MISMATCH",
  "COMPONENT_NOT_GENERATED",
  "COMPONENT_COUNT_INVALID",
  "COMPONENT_DIMENSION_INVALID",
  "COMPONENT_FINISH_FACES_INVALID",
  "COMPONENT_ID_DUPLICATE",
  "HARDWARE_ADAPTER_MISSING",
  "HARDWARE_MOUNTING_UNMAPPED",
  "EDGE_RULES_UNDEFINED",
  "EDGE_RULE_INVALID",
  // Recipe/product rule and parameter schema mismatches.
  "RULE_NOT_EVALUABLE",
  "PARAMETER_UNKNOWN",
  "PARAMETER_INVALID_TYPE",
  "PARAMETER_NOT_ALLOWED",
  "PARAMETER_DUPLICATES_DIMENSION",
  // Planning standard completeness/approval, and the room-wide TEST_FIXTURE notice.
  "PLANNING_VALUE_UNDEFINED",
  "PLANNING_STANDARD_NOT_APPROVED",
  "TEST_FIXTURE_DATA_IN_USE",
]);

export function classifyValidationCode(code: string): ValidationGroup {
  return REFERENCE_DATA_CODES.has(code) ? "REFERENCE_DATA" : "DESIGN";
}
