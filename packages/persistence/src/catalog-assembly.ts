import type { CatalogSnapshot, ConstructionRecipe, EdgeBand, Finish, HardwareRuleSet, Material, ProductDefinition } from "@lintel/types";
import { validateCatalog } from "@lintel/catalog-engine";
import type { RecordStatus } from "./envelope.js";

/** One pinned per-domain catalog release (M5 §2.5). Domains never share a release. */
export interface CatalogReleaseRef {
  readonly releaseId: string;
  readonly versionLabel: string;
  readonly status: RecordStatus;
}

export interface PinnedCatalogReleases {
  readonly material: CatalogReleaseRef & { readonly materials: readonly Material[]; readonly edgeBands: readonly EdgeBand[] };
  readonly finish: CatalogReleaseRef & { readonly finishes: readonly Finish[] };
  readonly hardware: CatalogReleaseRef & { readonly hardwareRuleSets: readonly HardwareRuleSet[] };
  readonly product: CatalogReleaseRef & { readonly products: readonly ProductDefinition[]; readonly recipes: readonly ConstructionRecipe[] };
}

export interface AssembledCatalog {
  readonly catalog: CatalogSnapshot;
  /** Why this catalog cannot drive production (unapproved releases, invalid references). Empty = none. */
  readonly problems: readonly string[];
}

const sortBy = <T>(items: readonly T[], id: (t: T) => string): T[] => [...items].sort((a, b) => (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0));

/**
 * Build the engine's CatalogSnapshot from the releases a DesignVersion pins. Deterministic:
 * the same releases always give the same snapshot and `catalogVersion`. Item statuses are kept
 * as mapped, so the engines still block anything unapproved.
 */
export function assembleCatalogSnapshot(r: PinnedCatalogReleases): AssembledCatalog {
  const catalog: CatalogSnapshot = {
    catalogVersion: `MAT:${r.material.versionLabel}|FIN:${r.finish.versionLabel}|HW:${r.hardware.versionLabel}|PRD:${r.product.versionLabel}`,
    products: sortBy(r.product.products, (p) => p.productId),
    recipes: sortBy(r.product.recipes, (x) => x.recipeId),
    materials: sortBy(r.material.materials, (m) => m.materialId),
    finishes: sortBy(r.finish.finishes, (f) => f.finishId),
    edgeBands: sortBy(r.material.edgeBands, (b) => b.edgeBandId),
    hardwareRuleSets: sortBy(r.hardware.hardwareRuleSets, (h) => h.ruleSetId),
  };
  const problems: string[] = [];
  for (const [domain, rel] of [["material", r.material], ["finish", r.finish], ["hardware", r.hardware], ["product", r.product]] as const) {
    if (rel.status !== "APPROVED" && rel.status !== "LOCKED") problems.push(`${domain} catalog release ${rel.releaseId} is ${rel.status}`);
  }
  for (const m of validateCatalog(catalog)) problems.push(`${m.code}: ${m.message}`);
  return { catalog, problems };
}
