/**
 * 0015: a DesignVersion's pinned product catalog version must contain the exact product_version of every one of its
 * design objects — enforced by the database whichever path writes (API role or direct), from both sides (re-pinning
 * the catalog, or changing a pinned DRAFT catalog's membership), and only within one organization.
 */
import { describe, expect, it } from "vitest";
import type { Tx } from "./support/db.js";
import { actAs, attemptDb, insertRow, one, tx } from "./support/db.js";
import type { Dependencies, DesignFixture, Item, World } from "./support/world.js";
import { catalogVersion, createWorld, dependencies, designVersion, productVersion } from "./support/world.js";

interface Setup {
  readonly w: World;
  readonly deps: Dependencies;
  readonly d: DesignFixture;
  readonly product: Item;
  /** A second exact version of the same product, not used by any object. */
  readonly productV2: Item;
  /** Catalog version 2 (same catalog entity): contains the product version the object uses. */
  readonly compatible: string;
  /** Catalog version 3 (same catalog entity): contains only the other product version. */
  readonly incompatible: string;
}

async function setup(c: Tx): Promise<Setup> {
  const w = await createWorld(c);
  const deps = await dependencies(c, w);
  const d = await designVersion(c, w, deps, { withRun: false });
  const product = deps.items.product;
  const recipe = deps.items.recipe;
  if (product === undefined || recipe === undefined) throw new Error("no product");
  await actAs(c, null);
  const productV2 = await productVersion(c, w, product, recipe.versionId, 2);
  const catalogEntity = (await one<{ entity_id: string }>(c, "SELECT entity_id FROM design_os.product_catalog_version WHERE id = $1", [deps.pins.product_catalog_version_id])).entity_id;
  const compatible = await catalogVersion(c, w, "product", [["product", product.entityId, product.versionId]], { entityId: catalogEntity, versionNumber: 2 });
  const incompatible = await catalogVersion(c, w, "product", [["product", productV2.entityId, productV2.versionId]], { entityId: catalogEntity, versionNumber: 3 });
  return { w, deps, d, product, productV2, compatible, incompatible };
}

async function failure(c: Tx, fn: () => Promise<unknown>): Promise<{ code: string; detail: unknown }> {
  const err = await attemptDb(c, fn);
  if (err === null) throw new Error("expected a database error");
  const code = err.code ?? "";
  return { code, detail: err.detail === undefined || !code.startsWith("LD") ? null : (JSON.parse(err.detail) as unknown) };
}

const repin = (c: Tx, designVersionId: string, catalogVersionId: string) => () =>
  c.query("UPDATE design_os.design_version SET product_catalog_version_id = $2 WHERE id = $1", [designVersionId, catalogVersionId]);

const pinnedCatalog = async (c: Tx, id: string): Promise<string> =>
  (await one<{ id: string }>(c, "SELECT product_catalog_version_id AS id FROM design_os.design_version WHERE id = $1", [id])).id;

describe("product catalog / design object compatibility (0015)", () => {
  it("a direct database update to a catalog version that excludes an object's product version is rejected (LD019), as owner and as the API role", async () => {
    await tx(async (c) => {
      const { w, deps, d, product, incompatible } = await setup(c);
      await actAs(c, null);
      expect(await failure(c, repin(c, d.designVersionId, incompatible))).toEqual({ code: "LD019", detail: { productVersionIds: [product.versionId] } });
      await actAs(c, w.actor("DESIGNER"), { apiRole: true });
      expect((await failure(c, repin(c, d.designVersionId, incompatible))).code).toBe("LD019");
      await actAs(c, null);
      expect(await pinnedCatalog(c, d.designVersionId)).toBe(deps.pins.product_catalog_version_id);
    });
  });

  it("a compatible catalog change succeeds and the existing objects stay valid", async () => {
    await tx(async (c) => {
      const { w, d, product, compatible } = await setup(c);
      await actAs(c, w.actor("DESIGNER"), { apiRole: true });
      await repin(c, d.designVersionId, compatible)();
      await actAs(c, null);
      expect(await pinnedCatalog(c, d.designVersionId)).toBe(compatible);
      expect((await one<{ outside: string[] }>(c, "SELECT design_os.products_outside_catalog($1, $2, $3) AS outside", [w.org, d.designVersionId, compatible])).outside).toEqual([]);
      const obj = await one<{ product_version_id: string }>(c, "SELECT product_version_id FROM design_os.design_object WHERE design_version_id = $1", [d.designVersionId]);
      expect(obj.product_version_id).toBe(product.versionId);
      // The object still satisfies the object-side guard against the new pin: it can be edited and a new one placed.
      await c.query("UPDATE design_os.design_object SET x_mm = 600 WHERE design_version_id = $1", [d.designVersionId]);
      await insertRow(c, "design_object", {
        org_id: w.org, design_version_id: d.designVersionId, object_code: "OBJ-KIT-002", lineage_id: "obj_002", object_type: "BASE_CABINET", product_code: "KIT_BASE_STANDARD",
        product_version_id: product.versionId, x_mm: 1200, y_mm: 0, z_mm: 0, rotation_y: 0, width_mm: 600, height_mm: 720, depth_mm: 560, parameters: { frontType: "OVERLAY" }, status: "DRAFT",
      });
    });
  });

  it("unrelated design versions and unrelated catalog members are unaffected", async () => {
    await tx(async (c) => {
      const { w, deps, d, incompatible } = await setup(c);
      // A design version with no objects may pin any product catalog version of its organization.
      const empty = await designVersion(c, w, deps, { withObject: false, withRun: false });
      await actAs(c, null);
      await repin(c, empty.designVersionId, incompatible)();
      // A rejected change on one version leaves another version (same org, same catalog, own object) untouched.
      const sibling = await designVersion(c, w, deps, { withRun: false });
      await actAs(c, null);
      expect((await failure(c, repin(c, d.designVersionId, incompatible))).code).toBe("LD019");
      expect(await pinnedCatalog(c, sibling.designVersionId)).toBe(deps.pins.product_catalog_version_id);
      // A non-catalog update of a version with objects is not affected by the guard.
      await c.query("UPDATE design_os.design_version SET change_reason = 'reworded' WHERE id = $1", [d.designVersionId]);
      // Members no object relies on can still be removed from a DRAFT catalog version (the empty design pins it, without objects).
      await c.query("DELETE FROM design_os.product_catalog_version_product WHERE catalog_version_id = $1", [incompatible]);
    });
  });

  it("the membership side: a DRAFT catalog version cannot drop or re-point a product version that a pinning design's objects use", async () => {
    await tx(async (c) => {
      const { w, d, product, productV2, compatible } = await setup(c);
      await actAs(c, null);
      await repin(c, d.designVersionId, compatible)();
      const drop = () => c.query("DELETE FROM design_os.product_catalog_version_product WHERE catalog_version_id = $1", [compatible]);
      expect(await failure(c, drop)).toEqual({ code: "LD019", detail: { productVersionIds: [product.versionId] } });
      const repoint = () => c.query("UPDATE design_os.product_catalog_version_product SET product_version_id = $2 WHERE catalog_version_id = $1", [compatible, productV2.versionId]);
      expect((await failure(c, repoint)).code).toBe("LD019");
      await actAs(c, w.actor("DESIGN_HEAD"), { apiRole: true }); // product_catalog.author, so RLS lets the delete reach the guard
      expect((await failure(c, drop)).code).toBe("LD019");
      await actAs(c, null);
      expect((await c.query("SELECT 1 FROM design_os.product_catalog_version_product WHERE catalog_version_id = $1 AND product_version_id = $2", [compatible, product.versionId])).rowCount).toBe(1);
    });
  });

  it("cross-tenant references cannot satisfy or bypass the rule", async () => {
    await tx(async (c) => {
      const { w, deps, d, product } = await setup(c);
      const other = await createWorld(c);
      const otherDeps = await dependencies(c, other);
      const otherProduct = otherDeps.items.product;
      if (otherProduct === undefined) throw new Error("no product");
      await actAs(c, null);
      // Another tenant's catalog version — even one holding the same product code — never contains this tenant's
      // product versions (membership is matched within the design version's own org), so the rule rejects it first;
      // for a version without objects the composite foreign key still makes the pin impossible.
      expect(await failure(c, repin(c, d.designVersionId, otherDeps.pins.product_catalog_version_id))).toEqual({ code: "LD019", detail: { productVersionIds: [product.versionId] } });
      const empty = await designVersion(c, w, deps, { withObject: false, withRun: false });
      await actAs(c, null);
      expect((await failure(c, repin(c, empty.designVersionId, otherDeps.pins.product_catalog_version_id))).code).toBe("23503");
      // Another tenant's catalog cannot list this tenant's product version, so it can never "contain" it.
      const otherEntity = (await one<{ entity_id: string }>(c, "SELECT entity_id FROM design_os.product_catalog_version WHERE id = $1", [otherDeps.pins.product_catalog_version_id])).entity_id;
      const otherDraft = await catalogVersion(c, other, "product", [["product", otherProduct.entityId, otherProduct.versionId]], { entityId: otherEntity, versionNumber: 2 });
      expect((await failure(c, () => c.query("UPDATE design_os.product_catalog_version_product SET org_id = $2, product_id = $3, product_version_id = $4 WHERE catalog_version_id = $1",
        [otherDraft, w.org, product.entityId, product.versionId]))).code).toBe("23503");
      // The compatibility check is scoped by organization: evaluated for the wrong org, nothing of this tenant is visible.
      expect((await one<{ outside: string[] }>(c, "SELECT design_os.products_outside_catalog($1, $2, $3) AS outside", [other.org, d.designVersionId, otherDraft])).outside).toEqual([]);
      // Through the API role (another tenant's claims), the design version is invisible and the helper is not executable.
      await actAs(c, other.actor("DESIGNER"), { apiRole: true });
      expect((await c.query("UPDATE design_os.design_version SET product_catalog_version_id = $2 WHERE id = $1", [d.designVersionId, otherDraft])).rowCount).toBe(0);
      expect((await failure(c, () => c.query("SELECT design_os.products_outside_catalog($1, $2, $3)", [w.org, d.designVersionId, otherDraft]))).code).toBe("42501");
      await actAs(c, null);
      expect(await pinnedCatalog(c, d.designVersionId)).not.toBe(otherDraft);
    });
  });
});
