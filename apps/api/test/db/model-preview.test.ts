/**
 * Resolved-model preview (M6 G3) against PostgreSQL: the exact version, its exact pins, the same resolution path as the
 * outputs (same room fingerprint as a generated BOM), deterministic, read-only, tenant-safe and permission-checked.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenerateResponse } from "../../src/modules/outputs/outputs.schemas.js";
import { ModelPreviewResponse } from "../../src/modules/model-preview/model-preview.schemas.js";
import type { DomainWorld } from "../support/domain.js";
import { cabinet, domainWorld, key } from "../support/domain.js";
import type { Api, Problem } from "../support/harness.js";
import { sql, startApi, world } from "../support/harness.js";
import { issueFixtures } from "../support/issue-fixtures.js";

let api: Api;
let d: DomainWorld;
const problem = (r: { json: () => unknown }) => r.json() as Problem;

beforeAll(async () => {
  api = await startApi();
  d = await domainWorld(api);
});
afterAll(async () => {
  await api.close();
});

const model = (versionId: string, as: string) => api.request({ method: "GET", url: `/api/v1/design-versions/${versionId}/model`, as });

describe("GET /design-versions/{id}/model", () => {
  it("resolves exactly this version with its exact pins and exposes objects, lineage, geometry, runs and validation", async () => {
    const f = issueFixtures(api, d);
    const { versionId } = await f.draftVersion();
    const productVersionId = (d.deps.items.product as { versionId: string }).versionId;
    const etag = (await api.request({ method: "GET", url: `/api/v1/design-versions/${versionId}`, as: d.w.users.DESIGNER })).headers.etag as string;
    expect((await api.request({ method: "POST", url: `/api/v1/design-versions/${versionId}/objects`, as: d.w.users.DESIGNER, payload: cabinet(productVersionId, "OBJ-KIT-002", 600), headers: { "if-match": etag } })).statusCode).toBe(201);

    const r = await model(versionId, d.w.users.DESIGNER);
    expect(r.statusCode).toBe(200);
    const m = ModelPreviewResponse.parse(r.json());
    const [v] = await sql<{ input_hash: string; construction_standard_version_id: string; product_catalog_version_id: string }>(
      "SELECT input_hash, construction_standard_version_id, product_catalog_version_id FROM design_os.design_version WHERE id = $1", [versionId]);
    expect(m.designVersion).toMatchObject({ id: versionId, status: "DRAFT", inputHash: v!.input_hash });
    expect(m.pins).toMatchObject({ constructionStandardVersionId: v!.construction_standard_version_id, productCatalogVersionId: v!.product_catalog_version_id });
    expect(m.room).toMatchObject({ length: 4200, width: 3200, height: 3000, wallThickness: 150 });
    expect(m.room.walls.map((w) => w.wallId)).toEqual(["A", "B", "C", "D"]);

    const lineage = await sql<{ id: string; lineage_id: string }>("SELECT id, lineage_id FROM design_os.design_object WHERE design_version_id = $1 ORDER BY object_code", [versionId]);
    expect(m.objects.map((o) => [o.objectId, o.lineageId, o.objectCode])).toEqual(lineage.map((l, i) => [l.id, l.lineage_id, `OBJ-KIT-00${String(i + 1)}`]));
    const first = m.objects[0]!;
    expect(first).toMatchObject({ productCode: "KIT_BASE_STANDARD", productVersionId, dimensions: { width: 600, height: 720, depth: 560 }, parameterSources: { frontType: "OBJECT" } });
    expect(first.components.length).toBeGreaterThan(0);
    for (const c of first.components) expect(c.box.size.x * c.box.size.y * c.box.size.z).toBeGreaterThan(0);
    expect(first.placement).toMatchObject({ wallId: "A", alongWall: { start: 0, end: 600 } });
    expect(m.runs).toEqual([expect.objectContaining({ wallId: "A", lineageIds: m.objects.map((o) => o.lineageId) })]);
    expect(m.validation.counts.BLOCKER + m.validation.counts.ERROR + m.validation.counts.WARNING + m.validation.counts.INFO).toBe(m.validation.messages.length);
    expect(m.validation.canApprove).toBe(m.validation.counts.BLOCKER === 0);
    expect(m.dataClassification).toBe("PRODUCTION");

    // Deterministic: identical inputs → identical model.
    expect(ModelPreviewResponse.parse((await model(versionId, d.w.users.DESIGNER)).json())).toEqual(m);

    // Same resolution path as the outputs: a BOM generated from this version carries the same room fingerprint.
    const bom = await api.request({ method: "POST", url: `/api/v1/design-versions/${versionId}/bom-snapshots`, as: d.w.users.DESIGNER, payload: { purpose: "PRELIMINARY" }, headers: { "idempotency-key": key() } });
    expect(bom.statusCode).toBe(201);
    const payload = GenerateResponse.parse(bom.json()).snapshot as unknown as { payload: { roomFingerprint: string } };
    expect(payload.payload.roomFingerprint).toBe(m.modelFingerprint);

    // Nothing was persisted by the preview: no validation run, no snapshot beyond the explicit BOM.
    const runs = await sql<{ n: string }>("SELECT count(*)::text AS n FROM design_os.validation_run WHERE design_version_id = $1 AND purpose = 'APPROVAL'", [versionId]);
    expect(runs[0]!.n).toBe("0");
  });

  it("gives every component its own along-wall range from the SAME wall-relative conversion as the object's own placement — not the room-global box, which only coincides with along-wall on walls A/C (hardening P0-2: multi-wall Elevation)", async () => {
    const f = issueFixtures(api, d);
    const { versionId } = await f.draftVersion();
    const productVersionId = (d.deps.items.product as { versionId: string }).versionId;
    let etag = (await api.request({ method: "GET", url: `/api/v1/design-versions/${versionId}`, as: d.w.users.DESIGNER })).headers.etag as string;
    const onA = await api.request({ method: "POST", url: `/api/v1/design-versions/${versionId}/objects`, as: d.w.users.DESIGNER, payload: cabinet(productVersionId, "OBJ-WALL-A", 0), headers: { "if-match": etag } });
    expect(onA.statusCode).toBe(201);
    etag = onA.headers.etag as string;
    // Room is 4200 (length, wall A/C) x 3200 (width, wall B/D); flush against wall B (x = room length) at along=0.
    const onB = await api.request({
      method: "POST", url: `/api/v1/design-versions/${versionId}/objects`, as: d.w.users.DESIGNER, headers: { "if-match": etag },
      payload: { ...cabinet(productVersionId, "OBJ-WALL-B", 0), position: { xMm: 4200, yMm: 0, zMm: 0 }, rotationY: 270 },
    });
    expect(onB.statusCode).toBe(201);

    const m = ModelPreviewResponse.parse((await model(versionId, d.w.users.DESIGNER)).json());
    const a = m.objects.find((o) => o.objectCode === "OBJ-WALL-A")!;
    const b = m.objects.find((o) => o.objectCode === "OBJ-WALL-B")!;
    expect(a.placement).toMatchObject({ wallId: "A" });
    expect(b.placement).toMatchObject({ wallId: "B", alongWall: { start: 0, end: 600 } });
    expect(a.components.length).toBeGreaterThan(0);
    expect(b.components.length).toBeGreaterThan(0);

    // Every component's own along-wall range must fall inside its object's own placement.alongWall range —
    // true on any wall only if each component was projected through that wall's own frame, not a shared axis.
    for (const c of [...a.components, ...b.components]) expect(c.alongWall).not.toBeNull();
    const aRange = a.placement!.alongWall;
    const bRange = b.placement!.alongWall;
    for (const c of a.components) {
      expect(c.alongWall!.start).toBeGreaterThanOrEqual(aRange.start - 1e-6);
      expect(c.alongWall!.end).toBeLessThanOrEqual(aRange.end + 1e-6);
    }
    for (const c of b.components) {
      expect(c.alongWall!.start).toBeGreaterThanOrEqual(bRange.start - 1e-6);
      expect(c.alongWall!.end).toBeLessThanOrEqual(bRange.end + 1e-6);
    }
    // The regression this guards: on wall B, a component's raw box.min.x sits near the room's fixed depth-lock
    // coordinate (~4200), nowhere near its correct 0-600mm along-wall range — confirming the fix actually
    // changed which axis is used, not just that some value happens to be present.
    for (const c of b.components) expect(c.box.min.x).toBeGreaterThan(bRange.end);
  });

  it("is tenant-safe, internal-only and needs reference.read; unknown versions are 404", async () => {
    const f = issueFixtures(api, d);
    const { versionId } = await f.draftVersion();
    const other = await world();
    expect(problem(await model(versionId, other.users.DESIGNER)).code).toBe("NOT_FOUND");
    expect(problem(await model(versionId, d.w.users.CLIENT)).code).toBe("IDENTITY_KIND_MISMATCH");
    expect(problem(await model("00000000-0000-4000-8000-000000000000", d.w.users.DESIGNER)).code).toBe("NOT_FOUND");
    expect((await model(versionId, d.w.users.DESIGN_HEAD)).statusCode).toBe(200);
    for (const method of ["POST", "PUT", "DELETE"] as const) expect([404, 405]).toContain((await api.request({ method, url: `/api/v1/design-versions/${versionId}/model`, as: d.w.users.DESIGNER })).statusCode);
  });
});
