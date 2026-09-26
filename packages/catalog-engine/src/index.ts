import type { CatalogSnapshot } from "@lintel/types";
import { EDGE_BANDS, FINISHES, MATERIALS } from "./data/materials.js";
import { HINGE_STANDARD, KIT_BASE_STANDARD, KITCHEN_BASE_STANDARD_V1 } from "./data/kit-base-standard.js";

export { EDGE_BANDS, FINISHES, MATERIALS } from "./data/materials.js";
export { HINGE_STANDARD, KIT_BASE_STANDARD, KITCHEN_BASE_STANDARD_V1 } from "./data/kit-base-standard.js";
export { LINTEL_CONSTRUCTION_STANDARD_DRAFT } from "./data/standards.js";
export { TEST_FIXTURE_CONSTRUCTION_STANDARD } from "./fixtures/test-construction-standard.js";
export { LINTEL_PLANNING_STANDARD_DRAFT, PLANNING_VARIABLES } from "./data/planning.js";
export type { PlanningVariableDefinition } from "./data/planning.js";
export { TEST_FIXTURE_PLANNING_STANDARD } from "./fixtures/test-planning-standard.js";
export * from "./lookup.js";
export * from "./symbols.js";
export { validateCatalog, validateStandard } from "./validate.js";

/** The V1 catalog. Versioned as a whole; any data change bumps catalogVersion. */
export const LINTEL_CATALOG: CatalogSnapshot = {
  catalogVersion: "2026.09.26-m1",
  products: [KIT_BASE_STANDARD],
  recipes: [KITCHEN_BASE_STANDARD_V1],
  materials: MATERIALS,
  finishes: FINISHES,
  edgeBands: EDGE_BANDS,
  hardwareRuleSets: [HINGE_STANDARD],
};
