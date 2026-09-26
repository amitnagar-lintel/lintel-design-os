import type {
  CatalogSnapshot,
  ConstructionRecipe,
  EdgeBand,
  Finish,
  HardwareRuleSet,
  Material,
  ProductDefinition,
} from "@lintel/types";

export function findProduct(c: CatalogSnapshot, productId: string): ProductDefinition | undefined {
  return c.products.find((p) => p.productId === productId);
}
export function findRecipe(c: CatalogSnapshot, recipeId: string): ConstructionRecipe | undefined {
  return c.recipes.find((r) => r.recipeId === recipeId);
}
export function findMaterial(c: CatalogSnapshot, materialId: string): Material | undefined {
  return c.materials.find((m) => m.materialId === materialId);
}
export function findFinish(c: CatalogSnapshot, finishId: string): Finish | undefined {
  return c.finishes.find((f) => f.finishId === finishId);
}
export function findEdgeBand(c: CatalogSnapshot, edgeBandId: string): EdgeBand | undefined {
  return c.edgeBands.find((e) => e.edgeBandId === edgeBandId);
}
export function findHardwareRuleSet(c: CatalogSnapshot, ruleSetId: string): HardwareRuleSet | undefined {
  return c.hardwareRuleSets.find((h) => h.ruleSetId === ruleSetId);
}
