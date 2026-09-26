/**
 * A committed domain world for the core design API tests (race database, dropped after the suite): an organization,
 * the exact pinned reference versions (tests/db builders: test-only synthetic values, approved), and a client,
 * project, members, room with a survey and a design — created THROUGH THE API.
 */
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { Tx } from "../../../../tests/db/support/db.js";
import type { Dependencies, World } from "../../../../tests/db/support/world.js";
import { catalogVersion, dependencies, productVersion } from "../../../../tests/db/support/world.js";
import type { Api } from "./harness.js";
import { admin, world } from "./harness.js";

export const key = () => randomUUID();

export interface DomainWorld {
  readonly w: World;
  readonly deps: Dependencies;
  readonly clientId: string;
  readonly projectId: string;
  readonly roomId: string;
  readonly revisionId: string;
  readonly designId: string;
  /** API pin names → exact versions. */
  readonly pins: Record<string, string | null>;
}

export const SURVEY = { lengthMm: 4200, widthMm: 3200, heightMm: 3000, wallThicknessMm: 150, source: "site survey" };

export async function domainWorld(api: Api, opts: { readonly withDeps?: boolean } = {}): Promise<DomainWorld> {
  const w = await world();
  let deps = { pins: {}, items: {} } as unknown as Dependencies;
  if (opts.withDeps !== false) {
    const c = await admin();
    try {
      await c.query("BEGIN");
      deps = await dependencies(c as unknown as Tx, w);
      await c.query("COMMIT");
    } finally {
      await c.end();
    }
  }
  const client = await api.request({ method: "POST", url: "/api/v1/clients", as: w.users.SALES, payload: { clientCode: `C-${w.org.slice(0, 8)}`, name: "Mehta Residence" } });
  expect(client.statusCode).toBe(201);
  const project = await api.request({ method: "POST", url: "/api/v1/projects", as: w.users.SALES, payload: { clientId: client.json<{ id: string }>().id, projectCode: `P-${w.org.slice(0, 8)}`, name: "Mehta kitchen" } });
  expect(project.statusCode).toBe(201);
  const projectId = project.json<{ id: string }>().id;
  for (const role of ["DESIGNER", "SITE_ENGINEER"] as const) {
    const m = await api.request({ method: "POST", url: `/api/v1/projects/${projectId}/members`, as: w.users.SALES, payload: { userId: w.users[role], role } });
    expect(m.statusCode).toBe(201);
  }
  const room = await api.request({ method: "POST", url: `/api/v1/projects/${projectId}/rooms`, as: w.users.SITE_ENGINEER, headers: { "idempotency-key": key() }, payload: { name: "Kitchen", roomType: "KITCHEN", initialSurvey: SURVEY } });
  expect(room.statusCode).toBe(201);
  const roomBody = room.json<{ id: string; latestRevision: { id: string } }>();
  const design = await api.request({ method: "POST", url: `/api/v1/rooms/${roomBody.id}/designs`, as: w.users.DESIGNER, headers: { "idempotency-key": key() }, payload: { name: "Kitchen design" } });
  expect(design.statusCode).toBe(201);
  const p = deps.pins as unknown as Record<string, string | null>;
  return {
    w, deps, clientId: client.json<{ id: string }>().id, projectId, roomId: roomBody.id, revisionId: roomBody.latestRevision.id, designId: design.json<{ id: string }>().id,
    pins: {
      constructionStandardVersionId: p.construction_standard_version_id ?? null, planningStandardVersionId: p.planning_standard_version_id ?? null,
      edgeBandStandardVersionId: p.edge_band_standard_version_id ?? null, materialCatalogVersionId: p.material_catalog_version_id ?? null,
      finishCatalogVersionId: p.finish_catalog_version_id ?? null, hardwareCatalogVersionId: p.hardware_catalog_version_id ?? null,
      productCatalogVersionId: p.product_catalog_version_id ?? null, hettichDatasetVersionId: p.hettich_dataset_version_id ?? null,
    },
  };
}

export function cabinet(productVersionId: string, code = "OBJ-KIT-001", x = 0) {
  return {
    objectCode: code, objectType: "BASE_CABINET", productCode: "KIT_BASE_STANDARD", productVersionId,
    position: { xMm: x, yMm: 0, zMm: 0 }, rotationY: 0, dimensions: { widthMm: 600, heightMm: 720, depthMm: 560 }, parameters: { frontType: "OVERLAY" },
  };
}

/**
 * Two more DRAFT versions of the world's product catalog (committed): `compatible` lists the exact product version
 * the world's objects use; `incompatible` lists only another exact version of the same product.
 */
export async function productCatalogVariants(d: DomainWorld): Promise<{ compatible: string; incompatible: string; otherProductVersionId: string }> {
  const product = d.deps.items.product;
  const recipe = d.deps.items.recipe;
  if (product === undefined || recipe === undefined) throw new Error("world has no product");
  const c = await admin();
  try {
    await c.query("BEGIN");
    const tx = c as unknown as Tx;
    const entity = (await c.query<{ entity_id: string }>("SELECT entity_id FROM design_os.product_catalog_version WHERE id = $1", [d.pins.productCatalogVersionId])).rows[0]?.entity_id;
    if (entity === undefined) throw new Error("no product catalog");
    const other = await productVersion(tx, d.w, product, recipe.versionId, 2);
    const compatible = await catalogVersion(tx, d.w, "product", [["product", product.entityId, product.versionId]], { entityId: entity, versionNumber: 2 });
    const incompatible = await catalogVersion(tx, d.w, "product", [["product", other.entityId, other.versionId]], { entityId: entity, versionNumber: 3 });
    await c.query("COMMIT");
    return { compatible, incompatible, otherProductVersionId: other.versionId };
  } finally {
    await c.end();
  }
}
