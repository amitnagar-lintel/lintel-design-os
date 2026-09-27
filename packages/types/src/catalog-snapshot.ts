import type { Appliance, EdgeBand, Finish, Material } from "./catalog.js";
import type { ConstructionRecipe, HardwareRuleSet, ProductDefinition } from "./product.js";

/**
 * An immutable, versioned view of catalog data consumed by the engines.
 * Engines never read catalog data from anywhere else (PRD §5 hierarchy).
 */
export interface CatalogSnapshot {
  readonly catalogVersion: string;
  readonly products: readonly ProductDefinition[];
  readonly recipes: readonly ConstructionRecipe[];
  readonly materials: readonly Material[];
  readonly finishes: readonly Finish[];
  readonly edgeBands: readonly EdgeBand[];
  readonly hardwareRuleSets: readonly HardwareRuleSet[];
  /** Design Studio Slice 5 step 3: appliances a recipe's `ApplianceParameterDefinition` may reference. */
  readonly appliances: readonly Appliance[];
}
