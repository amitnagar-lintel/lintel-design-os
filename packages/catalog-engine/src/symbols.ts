import type { ConstructionRecipe, ProductDefinition } from "@lintel/types";

/** Name of the boolean flag exposed for an enum value, e.g. FRONT + OVERLAY → FRONT_OVERLAY. */
export function enumFlag(symbol: string, value: string): string {
  return `${symbol}_${value}`;
}

/** Instance index variable available in component template expressions. */
export const INSTANCE_INDEX_VARIABLE = "i";

/** Formula variables contributed by product parameters. */
export function parameterSymbols(product: ProductDefinition): string[] {
  const out: string[] = [];
  for (const p of product.parameters) {
    switch (p.kind) {
      case "number":
      case "integer":
      case "material":
        out.push(p.symbol);
        break;
      case "enum":
        for (const v of p.values) out.push(enumFlag(p.symbol, v));
        break;
      case "finish":
        break;
    }
  }
  return out;
}

/** Every variable a recipe expression may legitimately reference (excluding `i`). */
export function recipeScopeSymbols(product: ProductDefinition, recipe: ConstructionRecipe): Set<string> {
  return new Set([
    ...parameterSymbols(product),
    ...recipe.formulas.map((f) => f.formulaId),
    ...recipe.constructionVariables.map((v) => v.key),
  ]);
}
