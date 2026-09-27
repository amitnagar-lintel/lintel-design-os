import type { CatalogSnapshot } from "@lintel/types";
import { EDGE_BANDS, FINISHES, MATERIALS } from "./data/materials.js";
import { APPLIANCES } from "./data/appliances.js";
import { HINGE_STANDARD, KIT_BASE_STANDARD, KITCHEN_BASE_STANDARD_V1 } from "./data/kit-base-standard.js";
import { DRAWER_STANDARD, KIT_BASE_DRAWER, KITCHEN_BASE_DRAWER_V1 } from "./data/kit-base-drawer.js";
import { KIT_BASE_OPEN, KITCHEN_BASE_OPEN_V1, OPEN_STANDARD } from "./data/kit-base-open.js";
import { KIT_BASE_PULLOUT, KITCHEN_BASE_PULLOUT_V1, PULLOUT_STANDARD } from "./data/kit-base-pullout.js";
import { KIT_BASE_SINK, KITCHEN_BASE_SINK_V1, SINK_STANDARD } from "./data/kit-base-sink.js";
import { HOB_STANDARD, KIT_BASE_HOB, KITCHEN_BASE_HOB_V1 } from "./data/kit-base-hob.js";
import { KIT_TALL_OVEN, KITCHEN_TALL_OVEN_V1, OVEN_TOWER_STANDARD } from "./data/kit-tall-oven.js";

export { EDGE_BANDS, FINISHES, MATERIALS } from "./data/materials.js";
export { APPLIANCES } from "./data/appliances.js";
export { HINGE_STANDARD, KIT_BASE_STANDARD, KITCHEN_BASE_STANDARD_V1 } from "./data/kit-base-standard.js";
export { DRAWER_STANDARD, KIT_BASE_DRAWER, KITCHEN_BASE_DRAWER_V1 } from "./data/kit-base-drawer.js";
export { KIT_BASE_OPEN, KITCHEN_BASE_OPEN_V1, OPEN_STANDARD } from "./data/kit-base-open.js";
export { KIT_BASE_PULLOUT, KITCHEN_BASE_PULLOUT_V1, PULLOUT_STANDARD } from "./data/kit-base-pullout.js";
export { KIT_BASE_SINK, KITCHEN_BASE_SINK_V1, SINK_STANDARD } from "./data/kit-base-sink.js";
export { HOB_STANDARD, KIT_BASE_HOB, KITCHEN_BASE_HOB_V1 } from "./data/kit-base-hob.js";
export { KIT_TALL_OVEN, KITCHEN_TALL_OVEN_V1, OVEN_TOWER_STANDARD } from "./data/kit-tall-oven.js";
export { LINTEL_CONSTRUCTION_STANDARD_DRAFT, LINTEL_EDGE_BAND_STANDARD_DRAFT } from "./data/standards.js";
export { TEST_FIXTURE_CONSTRUCTION_STANDARD } from "./fixtures/test-construction-standard.js";
export { TEST_FIXTURE_EDGE_BAND_STANDARD } from "./fixtures/test-edge-band-standard.js";
export { TEST_FIXTURE_APPLIANCES } from "./fixtures/test-appliances.js";
export { LINTEL_PLANNING_STANDARD_DRAFT, PLANNING_VARIABLES } from "./data/planning.js";
export type { PlanningVariableDefinition } from "./data/planning.js";
export { TEST_FIXTURE_PLANNING_STANDARD } from "./fixtures/test-planning-standard.js";
export * from "./lookup.js";
export * from "./symbols.js";
export { validateCatalog, validateEdgeBandStandard, validateStandard } from "./validate.js";

/** The V1 catalog. Versioned as a whole; any data change bumps catalogVersion. */
export const LINTEL_CATALOG: CatalogSnapshot = {
  catalogVersion: "2026.10.03-m8",
  products: [KIT_BASE_STANDARD, KIT_BASE_DRAWER, KIT_BASE_OPEN, KIT_BASE_PULLOUT, KIT_TALL_OVEN, KIT_BASE_SINK, KIT_BASE_HOB],
  recipes: [KITCHEN_BASE_STANDARD_V1, KITCHEN_BASE_DRAWER_V1, KITCHEN_BASE_OPEN_V1, KITCHEN_BASE_PULLOUT_V1, KITCHEN_TALL_OVEN_V1, KITCHEN_BASE_SINK_V1, KITCHEN_BASE_HOB_V1],
  materials: MATERIALS,
  finishes: FINISHES,
  edgeBands: EDGE_BANDS,
  hardwareRuleSets: [HINGE_STANDARD, DRAWER_STANDARD, OPEN_STANDARD, PULLOUT_STANDARD, OVEN_TOWER_STANDARD, SINK_STANDARD, HOB_STANDARD],
  appliances: APPLIANCES,
};
