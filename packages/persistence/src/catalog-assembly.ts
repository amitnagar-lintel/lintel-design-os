import type { Appliance, CatalogSnapshot, ConstructionRecipe, EdgeBand, Finish, HardwareRuleSet, Material, ProductDefinition } from "@lintel/types";
import { validateCatalog } from "@lintel/catalog-engine";
import type { RecordLifecycleStatus } from "./envelope.js";

/**
 * One pinned per-domain catalog VERSION (M5 §2.5): an exact, immutable version record whose frozen
 * membership lists exact item versions. Publishing a newer catalog version never changes a pinned one.
 */
export interface CatalogVersionRef {
  readonly catalogVersionId: string;
  readonly versionLabel: string;
  readonly status: RecordLifecycleStatus;
}

export interface PinnedCatalogReleases {
  readonly material: CatalogVersionRef & { readonly materials: readonly Material[]; readonly edgeBands: readonly EdgeBand[] };
  readonly finish: CatalogVersionRef & { readonly finishes: readonly Finish[] };
  readonly hardware: CatalogVersionRef & { readonly hardwareRuleSets: readonly HardwareRuleSet[] };
  /** Design Studio Slice 5 step 3: `applianceCatalogVersionId` is an OPTIONAL pin (`design-versions.schemas.ts`) —
   * absent/null whenever nothing in the design references an appliance yet, in which case the catalog carries
   * no appliances at all (never a production-blocking problem, unlike the four required catalogs above). */
  readonly appliance?: (CatalogVersionRef & { readonly appliances: readonly Appliance[] }) | null;
  readonly product: CatalogVersionRef & { readonly products: readonly ProductDefinition[]; readonly recipes: readonly ConstructionRecipe[] };
}

export interface AssembledCatalog {
  readonly catalog: CatalogSnapshot;
  /** Why this catalog cannot drive production (unapproved catalog versions, invalid references). Empty = none. */
  readonly problems: readonly string[];
}

const sortBy = <T>(items: readonly T[], id: (t: T) => string): T[] => [...items].sort((a, b) => (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0));

/**
 * Build the engine's CatalogSnapshot from the catalog versions a DesignVersion pins. Deterministic:
 * the same catalog versions always give the same snapshot and `catalogVersion`. Item statuses are kept
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
    appliances: sortBy(r.appliance?.appliances ?? [], (a) => a.applianceId),
  };
  const problems: string[] = [];
  for (const [domain, rel] of [["material", r.material], ["finish", r.finish], ["hardware", r.hardware], ["product", r.product]] as const) {
    if (rel.status !== "APPROVED" && rel.status !== "LOCKED") problems.push(`${domain} catalog version ${rel.catalogVersionId} is ${rel.status}`);
  }
  if (r.appliance != null && r.appliance.status !== "APPROVED" && r.appliance.status !== "LOCKED") {
    problems.push(`appliance catalog version ${r.appliance.catalogVersionId} is ${r.appliance.status}`);
  }
  for (const m of validateCatalog(catalog)) problems.push(`${m.code}: ${m.message}`);
  return { catalog, problems };
}
