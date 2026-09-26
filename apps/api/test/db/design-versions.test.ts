/**
 * DesignVersions over HTTP (M5 Step 5): exact pins, draft-only content with the whole-draft ETag, input hash /
 * input revision / content hash, copy-on-write versions, the single transition path, and engine validation runs.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { engineIdentity } from "../../src/modules/design-versions/engine.js";
import { ObjectResponse, ValidationRunResponse, VersionResponse, VersionState } from "../../src/modules/design-versions/design-versions.schemas.js";
import type { DomainWorld } from "../support/domain.js";
import { cabinet, domainWorld, key, productCatalogVariants } from "../support/domain.js";
import type { Api, Problem } from "../support/harness.js";
import { sql, startApi, TEST_BUILD, world } from "../support/harness.js";

let api: Api;
let d: DomainWorld;
let productVersionId: string;
beforeAll(async () => {
  api = await startApi();
  d = await domainWorld(api);
  productVersionId = (d.deps.items.product as { versionId: string }).versionId;
});
afterAll(async () => {
  await api.close();
});

const problem = (r: { json: () => unknown }) => r.json() as Problem;
type Res = Awaited<ReturnType<Api["request"]>>;
const as = (role: keyof DomainWorld["w"]["users"]) => d.w.users[role];

async function newVersion(extra: Record<string, unknown> = {}, role: keyof DomainWorld["w"]["users"] = "DESIGNER"): Promise<Res> {
  return api.request({ method: "POST", url: `/api/v1/designs/${d.designId}/versions`, as: as(role), headers: { "idempotency-key": key() }, payload: { pins: d.pins, changeReason: "first draft", ...extra } });
}
async function getVersion(id: string): Promise<{ v: ReturnType<typeof VersionResponse.parse>; etag: string }> {
  const r = await api.request({ method: "GET", url: `/api/v1/design-versions/${id}`, as: as("DESIGNER") });
  return { v: VersionResponse.parse(r.json()), etag: r.headers.etag as string };
}
const addObject = (versionId: string, etag: string | undefined, body: Record<string, unknown>) =>
  api.request({ method: "POST", url: `/api/v1/design-versions/${versionId}/objects`, as: as("DESIGNER"), payload: body, ...(etag === undefined ? {} : { headers: { "if-match": etag } }) });
const transition = (versionId: string, etag: string, body: Record<string, unknown>, role: keyof DomainWorld["w"]["users"] = "DESIGNER", k = key()) =>
  api.request({ method: "POST", url: `/api/v1/design-versions/${versionId}/transitions`, as: as(role), payload: body, headers: { "if-match": etag, "idempotency-key": k } });
const validate = (versionId: string, headers: Record<string, string> = {}, payload: Record<string, unknown> = {}) =>
  api.request({ method: "POST", url: `/api/v1/design-versions/${versionId}/validation-runs`, as: as("DESIGNER"), payload, headers: { "idempotency-key": key(), ...headers } });

describe("creating versions: exact pins", () => {
  it("every required pin must be an exact version (400 lists the missing ones)", async () => {
    const r = await newVersion({ pins: { constructionStandardVersionId: d.pins.constructionStandardVersionId } });
    expect(problem(r).code).toBe("VALIDATION_FAILED");
    expect(problem(r).errors?.map((e) => e.path).sort()).toEqual([
      "body.pins.edgeBandStandardVersionId", "body.pins.finishCatalogVersionId", "body.pins.hardwareCatalogVersionId", "body.pins.hettichDatasetVersionId",
      "body.pins.materialCatalogVersionId", "body.pins.planningStandardVersionId", "body.pins.productCatalogVersionId",
    ]);
  });
  it("a new DRAFT pins exactly what was given, the room's latest survey, and gets a strong whole-draft ETag", async () => {
    const r = await newVersion({ versionLabel: "v1" });
    expect(r.statusCode).toBe(201);
    const v = VersionResponse.parse(r.json());
    expect(v).toMatchObject({ status: "DRAFT", versionNumber: 1, versionLabel: "v1", roomRevisionId: d.revisionId, basedOnVersionId: null, validation: null, designId: d.designId, projectId: d.projectId });
    expect(v.pins).toMatchObject({ ...d.pins, manufacturingStandardVersionId: null, pricingStandardVersionId: null, quotationPolicyVersionId: null, applianceCatalogVersionId: null });
    expect(r.headers.etag).toBe(`"${v.id}:${String(v.rowVersion)}"`);
    expect(v.inputHash).not.toBe(`sha256:${"0".repeat(64)}`);
  });
  it("a foreign or unknown pin is refused (422), never silently accepted", async () => {
    const r = await newVersion({ pins: { ...d.pins, hettichDatasetVersionId: randomUUID() } });
    expect([r.statusCode, problem(r).code]).toEqual([422, "INVALID_REFERENCE"]);
  });
  it("status can never be set through a create or update body", async () => {
    expect((await newVersion({ status: "APPROVED" })).statusCode).toBe(400);
    const v = VersionResponse.parse((await newVersion()).json());
    const { etag } = await getVersion(v.id);
    expect((await api.request({ method: "PATCH", url: `/api/v1/design-versions/${v.id}`, as: as("DESIGNER"), payload: { status: "LOCKED" }, headers: { "if-match": etag } })).statusCode).toBe(400);
  });
});

describe("draft content: objects and overrides", () => {
  it("objects need the version's current ETag; each change moves the input hash, the input revision, the content hash and the ETag", async () => {
    const v0 = VersionResponse.parse((await newVersion()).json());
    const { etag } = await getVersion(v0.id);
    expect(problem(await addObject(v0.id, undefined, cabinet(productVersionId))).code).toBe("PRECONDITION_REQUIRED");
    expect(problem(await addObject(v0.id, `"${v0.id}:999"`, cabinet(productVersionId))).code).toBe("STALE_VERSION");
    const r = await addObject(v0.id, etag, cabinet(productVersionId));
    expect(r.statusCode).toBe(201);
    const body = r.json<{ object: unknown; designVersion: unknown }>();
    const obj = ObjectResponse.parse(body.object);
    const state = VersionState.parse(body.designVersion);
    expect(obj).toMatchObject({ objectCode: "OBJ-KIT-001", productVersionId, rotationY: 0, dimensions: { widthMm: 600, heightMm: 720, depthMm: 560 }, status: "DRAFT" });
    expect(obj.lineageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.headers.etag).toBe(state.etag);
    expect(state.inputHash).not.toBe(v0.inputHash);
    expect(state.inputRevision).toBeGreaterThan(v0.inputRevision);
    expect(state.contentHash).not.toBe(v0.contentHash);
    // The old ETag is now stale.
    expect(problem(await addObject(v0.id, etag, cabinet(productVersionId, "OBJ-KIT-002", 600))).code).toBe("STALE_VERSION");
  });
  it("database rules come back as problems: duplicate code 409, product outside the pinned catalog 422, non-quarter-turn rotation 400", async () => {
    const v = VersionResponse.parse((await newVersion()).json());
    let { etag } = await getVersion(v.id);
    etag = (await addObject(v.id, etag, cabinet(productVersionId))).headers.etag as string;
    const dup = await addObject(v.id, etag, cabinet(productVersionId));
    expect([dup.statusCode, problem(dup).code]).toEqual([409, "DUPLICATE_RESOURCE"]);
    const outside = await addObject(v.id, etag, cabinet(randomUUID(), "OBJ-KIT-009"));
    expect([outside.statusCode, problem(outside).code]).toEqual([422, "INVALID_REFERENCE"]);
    expect((await addObject(v.id, etag, { ...cabinet(productVersionId, "OBJ-KIT-010"), rotationY: 45 })).statusCode).toBe(400);
    expect((await addObject(v.id, etag, { ...cabinet(productVersionId, "OBJ-KIT-011"), dimensions: { widthMm: 0, heightMm: 720, depthMm: 560 } })).statusCode).toBe(400);
  });
  it("updating keeps lineage and code; overrides reference lineage ids, keep their version history, and block deleting a referenced object", async () => {
    const v = VersionResponse.parse((await newVersion()).json());
    let { etag } = await getVersion(v.id);
    const a = await addObject(v.id, etag, cabinet(productVersionId, "OBJ-A", 0));
    etag = a.headers.etag as string;
    const objA = ObjectResponse.parse(a.json<{ object: unknown }>().object);
    const b = await addObject(v.id, etag, cabinet(productVersionId, "OBJ-B", 650));
    etag = b.headers.etag as string;
    const objB = ObjectResponse.parse(b.json<{ object: unknown }>().object);
    const moved = await api.request({ method: "PATCH", url: `/api/v1/design-objects/${objB.id}`, as: as("DESIGNER"), payload: { position: { xMm: 620, yMm: 0, zMm: 0 } }, headers: { "if-match": etag } });
    expect(ObjectResponse.parse(moved.json<{ object: unknown }>().object)).toMatchObject({ lineageId: objB.lineageId, objectCode: "OBJ-B", position: { xMm: 620 } });
    etag = moved.headers.etag as string;
    expect((await api.request({ method: "PATCH", url: `/api/v1/design-objects/${objB.id}`, as: as("DESIGNER"), payload: { objectCode: "X" }, headers: { "if-match": etag } })).statusCode).toBe(400);
    const ov = (objectIds: string[], e: string) => api.request({ method: "POST", url: `/api/v1/design-versions/${v.id}/overrides`, as: as("DESIGNER"), headers: { "if-match": e, "idempotency-key": key() },
      payload: { overrideCode: "GAP-AB", kind: "INTENTIONAL_GAP", objectIds, reason: "service void behind the gap" } });
    expect(problem(await ov(["not-a-lineage"], etag)).code).toBe("INVALID_REFERENCE");
    const o1 = await ov([objA.lineageId, objB.lineageId], etag);
    expect([o1.statusCode, o1.json<{ override: { version: number } }>().override.version]).toEqual([201, 1]);
    const o2 = await ov([objA.lineageId, objB.lineageId], o1.headers.etag as string);
    expect(o2.json<{ override: { version: number } }>().override.version).toBe(2);
    etag = o2.headers.etag as string;
    const history = (await api.request({ method: "GET", url: `/api/v1/design-versions/${v.id}/overrides`, as: as("DESIGNER") })).json<{ items: { version: number }[] }>().items;
    expect(history.map((h) => h.version)).toEqual([1, 2]);
    const del = await api.request({ method: "DELETE", url: `/api/v1/design-objects/${objA.id}`, as: as("DESIGNER"), headers: { "if-match": etag } });
    expect([del.statusCode, problem(del).code, problem(del).context]).toEqual([422, "INVALID_REFERENCE", { overrideCodes: ["GAP-AB"] }]);
    const rm = await api.request({ method: "DELETE", url: `/api/v1/design-versions/${v.id}/overrides/GAP-AB`, as: as("DESIGNER"), headers: { "if-match": etag } });
    expect(rm.json<{ deleted: { versions: number } }>().deleted.versions).toBe(2);
    const del2 = await api.request({ method: "DELETE", url: `/api/v1/design-objects/${objA.id}`, as: as("DESIGNER"), headers: { "if-match": rm.headers.etag as string } });
    expect(del2.statusCode).toBe(200);
    const listed = (await api.request({ method: "GET", url: `/api/v1/design-versions/${v.id}/objects`, as: as("DESIGNER") })).json<{ items: { objectCode: string }[] }>().items;
    expect(listed.map((o) => o.objectCode)).toEqual(["OBJ-B"]);
  });
  it("draft metadata edits move the content hash but not the input hash; roles without authoring cannot edit", async () => {
    const v = VersionResponse.parse((await newVersion()).json());
    const { etag } = await getVersion(v.id);
    const r = await api.request({ method: "PATCH", url: `/api/v1/design-versions/${v.id}`, as: as("DESIGNER"), payload: { versionLabel: "client option B" }, headers: { "if-match": etag } });
    const after = VersionResponse.parse(r.json());
    expect([after.inputHash === v.inputHash, after.contentHash === v.contentHash, after.versionLabel]).toEqual([true, false, "client option B"]);
    expect(problem(await api.request({ method: "PATCH", url: `/api/v1/design-versions/${v.id}`, as: as("SALES"), payload: { versionLabel: "x" }, headers: { "if-match": r.headers.etag as string } })).code).toBe("PERMISSION_DENIED");
  });
  it("re-pinning the product catalog: a catalog without a placed object's exact product version is refused (422, draft unchanged); a compatible one keeps the objects", async () => {
    const { compatible, incompatible } = await productCatalogVariants(d);
    const v = VersionResponse.parse((await newVersion()).json());
    let { etag } = await getVersion(v.id);
    const placed = await addObject(v.id, etag, cabinet(productVersionId));
    etag = placed.headers.etag as string;
    const repin = (catalog: string, ifMatch: string) =>
      api.request({ method: "PATCH", url: `/api/v1/design-versions/${v.id}`, as: as("DESIGNER"), payload: { pins: { productCatalogVersionId: catalog } }, headers: { "if-match": ifMatch } });
    const refused = await repin(incompatible, etag);
    expect([refused.statusCode, problem(refused).code, problem(refused).context]).toEqual([422, "INVALID_REFERENCE", { productVersionIds: [productVersionId] }]);
    const unchanged = await getVersion(v.id);
    expect([unchanged.etag, unchanged.v.pins.productCatalogVersionId]).toEqual([etag, d.pins.productCatalogVersionId]);
    const ok = await repin(compatible, etag);
    expect(ok.statusCode).toBe(200);
    const after = VersionResponse.parse(ok.json());
    expect(after.pins.productCatalogVersionId).toBe(compatible);
    expect(after.inputHash).not.toBe(v.inputHash);
    const objects = await api.request({ method: "GET", url: `/api/v1/design-versions/${v.id}/objects`, as: as("DESIGNER") });
    expect(objects.json<{ items: { productVersionId: string; objectCode: string }[] }>().items.map((o) => [o.objectCode, o.productVersionId])).toEqual([["OBJ-KIT-001", productVersionId]]);
    // The objects remain valid under the new pin: another can still be placed with the same exact product version.
    expect((await addObject(v.id, ok.headers.etag as string, cabinet(productVersionId, "OBJ-KIT-002", 600))).statusCode).toBe(201);
    // Direct rows agree (the database guard, not only the API, holds the invariant).
    const rows = await sql<{ outside: string[] }>("SELECT design_os.products_outside_catalog(org_id, id, product_catalog_version_id) AS outside FROM design_os.design_version WHERE id = $1", [v.id]);
    expect(rows[0]?.outside).toEqual([]);
  });
  it("based-on versions copy pins, survey, objects (same lineage) and override history — and hash identically", async () => {
    const v1 = VersionResponse.parse((await newVersion()).json());
    const e1 = (await addObject(v1.id, (await getVersion(v1.id)).etag, cabinet(productVersionId, "OBJ-COPY"))).headers.etag as string;
    const lineage = ((await api.request({ method: "GET", url: `/api/v1/design-versions/${v1.id}/objects`, as: as("DESIGNER") })).json<{ items: { lineageId: string; id: string }[] }>().items[0]);
    await api.request({ method: "POST", url: `/api/v1/design-versions/${v1.id}/overrides`, as: as("DESIGNER"), headers: { "if-match": e1, "idempotency-key": key() }, payload: { overrideCode: "EP", kind: "END_PANEL", objectIds: [lineage?.lineageId], reason: "exposed end" } });
    const v1now = (await getVersion(v1.id)).v;
    const r = await api.request({ method: "POST", url: `/api/v1/designs/${d.designId}/versions`, as: as("DESIGNER"), headers: { "idempotency-key": key() }, payload: { basedOnVersionId: v1.id, changeReason: "option 2" } });
    const v2 = VersionResponse.parse(r.json());
    expect([v2.basedOnVersionId, v2.inputHash, v2.status]).toEqual([v1.id, v1now.inputHash, "DRAFT"]);
    expect(v2.pins).toEqual(v1now.pins);
    const copied = (await api.request({ method: "GET", url: `/api/v1/design-versions/${v2.id}/objects`, as: as("DESIGNER") })).json<{ items: { lineageId: string; id: string }[] }>().items;
    expect(copied.map((o) => o.lineageId)).toEqual([lineage?.lineageId]);
    expect(copied[0]?.id).not.toBe(lineage?.id);
    expect((await api.request({ method: "GET", url: `/api/v1/design-versions/${v2.id}/overrides`, as: as("DESIGNER") })).json<{ items: unknown[] }>().items).toHaveLength(1);
    const foreign = await api.request({ method: "POST", url: `/api/v1/designs/${d.designId}/versions`, as: as("DESIGNER"), headers: { "idempotency-key": key() }, payload: { basedOnVersionId: randomUUID(), changeReason: "x" } });
    expect(problem(foreign).code).toBe("INVALID_REFERENCE");
  });
});

describe("validation runs", () => {
  it("the engine decides: the run records the current exact inputs, engine version/hash and counts consistent with its messages", async () => {
    const v = VersionResponse.parse((await newVersion()).json());
    await addObject(v.id, (await getVersion(v.id)).etag, cabinet(productVersionId));
    const { v: current } = await getVersion(v.id);
    const r = await validate(v.id);
    expect(r.statusCode).toBe(201);
    const run = ValidationRunResponse.parse(r.json());
    // Provenance: which engine version ran, which exact build, the resulting fingerprint, and the validated input hash.
    const engine = engineIdentity(TEST_BUILD);
    expect(run).toMatchObject({ designVersionId: v.id, inputHash: current.inputHash, inputRevision: current.inputRevision, engineVersion: "0.1.0", engineBuild: TEST_BUILD, engineHash: engine.hash, current: true });
    expect(run.engineHash).toMatch(/^sha256:/);
    const [row] = await sql<{ engine_version: string; engine_build: string; engine_hash: string; input_hash: string }>("SELECT engine_version, engine_build, engine_hash, input_hash FROM design_os.validation_run WHERE id = $1", [run.id]);
    expect(row).toEqual({ engine_version: "0.1.0", engine_build: TEST_BUILD, engine_hash: engine.hash, input_hash: current.inputHash });
    expect(run.blockerCount).toBe(run.messages.filter((m) => m.severity === "BLOCKER").length);
    expect(run.warningCount).toBe(run.messages.filter((m) => m.severity === "WARNING").length);
    expect(run.canApprove).toBe(run.blockerCount === 0);
    const stored = await sql<{ blocker_count: number; created_by: string }>("SELECT blocker_count, created_by FROM design_os.validation_run WHERE id = $1", [run.id]);
    expect(stored).toEqual([{ blocker_count: run.blockerCount, created_by: as("DESIGNER") }]);
    expect((await getVersion(v.id)).v.validation).toMatchObject({ runId: run.id, current: true, blockerCount: run.blockerCount });
  });
  it("a client can never submit its own results; the key is required; a stale If-Match is refused", async () => {
    const v = VersionResponse.parse((await newVersion()).json());
    expect((await validate(v.id, {}, { blockerCount: 0, warningCount: 0 })).statusCode).toBe(400);
    expect((await api.request({ method: "POST", url: `/api/v1/design-versions/${v.id}/validation-runs`, as: as("DESIGNER"), payload: {} })).statusCode).toBe(428);
    expect(problem(await validate(v.id, { "if-match": `"${v.id}:999"` })).code).toBe("STALE_VERSION");
    expect((await validate(v.id, { "if-match": (await getVersion(v.id)).etag })).statusCode).toBe(201);
  });
  it("a run becomes stale when the inputs change: listed as not current, and SUBMIT needs a new one", async () => {
    const v = VersionResponse.parse((await newVersion()).json());
    const run = ValidationRunResponse.parse((await validate(v.id)).json());
    await addObject(v.id, (await getVersion(v.id)).etag, cabinet(productVersionId, "OBJ-LATE"));
    const runs = (await api.request({ method: "GET", url: `/api/v1/design-versions/${v.id}/validation-runs`, as: as("DESIGNER") })).json<{ items: { id: string; current: boolean }[] }>().items;
    expect(runs).toEqual([expect.objectContaining({ id: run.id, current: false })]);
    const submit = await transition(v.id, (await getVersion(v.id)).etag, { action: "SUBMIT", reason: "ready" });
    expect([submit.statusCode, problem(submit).code]).toEqual([409, "VALIDATION_RUN_REQUIRED"]);
  });
});

describe("lifecycle: only through transitions", () => {
  it("DRAFT → IN_REVIEW freezes the content (409 even with the correct ETag); approval needs the reviewed content hash; D8 applies", async () => {
    const v = VersionResponse.parse((await newVersion()).json());
    await addObject(v.id, (await getVersion(v.id)).etag, cabinet(productVersionId));
    const run = ValidationRunResponse.parse((await validate(v.id)).json());
    expect(problem(await transition(v.id, `"${v.id}:1"`, { action: "SUBMIT", reason: "ready" })).code).toBe("STALE_VERSION");
    const k = key();
    const submitted = await transition(v.id, (await getVersion(v.id)).etag, { action: "SUBMIT", reason: "ready for review" }, "DESIGNER", k);
    expect([submitted.statusCode, VersionResponse.parse(submitted.json()).status]).toEqual([200, "IN_REVIEW"]);
    const replay = await transition(v.id, "\"ignored-on-replay\"", { action: "SUBMIT", reason: "ready for review" }, "DESIGNER", k);
    expect([replay.statusCode, replay.headers["idempotent-replayed"]]).toEqual([200, "true"]);
    const { v: inReview, etag } = await getVersion(v.id);
    const frozen = await addObject(v.id, etag, cabinet(productVersionId, "OBJ-LATE"));
    expect([frozen.statusCode, problem(frozen).code]).toEqual([409, "RECORD_NOT_EDITABLE"]);
    expect(problem(await api.request({ method: "PATCH", url: `/api/v1/design-versions/${v.id}`, as: as("DESIGNER"), payload: { versionLabel: "x" }, headers: { "if-match": etag } })).code).toBe("RECORD_NOT_EDITABLE");
    expect((await transition(v.id, etag, { action: "APPROVE", reason: "ok" }, "DESIGN_HEAD")).statusCode).toBe(400);
    expect(problem(await transition(v.id, etag, { action: "APPROVE", reason: "ok", expectedContentHash: `sha256:${"a".repeat(64)}` }, "DESIGN_HEAD")).code).toBe("CONTENT_HASH_MISMATCH");
    expect(problem(await transition(v.id, etag, { action: "APPROVE", reason: "ok", expectedContentHash: inReview.contentHash }, "DESIGNER")).code).toBe("PERMISSION_DENIED");
    const approve = await transition(v.id, etag, { action: "APPROVE", reason: "approved", expectedContentHash: inReview.contentHash }, "DESIGN_HEAD");
    if (run.blockerCount === 0) {
      expect(VersionResponse.parse(approve.json()).status).toBe("APPROVED");
    } else {
      // The engine found BLOCKERs in this (synthetic) data: approval is refused by the database, as it must be.
      expect([approve.statusCode, problem(approve).code]).toEqual([409, "VALIDATION_BLOCKERS"]);
      const back = await transition(v.id, etag, { action: "REQUEST_CHANGES", reason: "fix the blockers" }, "DESIGN_HEAD");
      expect(VersionResponse.parse(back.json()).status).toBe("DRAFT");
    }
  });
  it("REQUEST_CHANGES returns to DRAFT; edits then change the content hash, so the old review can never approve it", async () => {
    const v = VersionResponse.parse((await newVersion()).json());
    await validate(v.id);
    await transition(v.id, (await getVersion(v.id)).etag, { action: "SUBMIT", reason: "ready" });
    const reviewed = await getVersion(v.id);
    const back = await transition(v.id, reviewed.etag, { action: "REQUEST_CHANGES", reason: "add the sink cabinet" }, "DESIGN_HEAD");
    expect(VersionResponse.parse(back.json()).status).toBe("DRAFT");
    await addObject(v.id, back.headers.etag, cabinet(productVersionId));
    await validate(v.id);
    await transition(v.id, (await getVersion(v.id)).etag, { action: "SUBMIT", reason: "again" });
    const again = await getVersion(v.id);
    expect(again.v.contentHash).not.toBe(reviewed.v.contentHash);
    const stale = await transition(v.id, again.etag, { action: "APPROVE", reason: "ok", expectedContentHash: reviewed.v.contentHash }, "DESIGN_HEAD");
    expect(problem(stale).code).toBe("CONTENT_HASH_MISMATCH");
  });
  it("a submitter can never review their own submission (D8), even with the approve permission", async () => {
    const v = VersionResponse.parse((await newVersion({}, "DESIGN_HEAD")).json());
    await validate(v.id);
    await transition(v.id, (await getVersion(v.id)).etag, { action: "SUBMIT", reason: "ready" }, "DESIGN_HEAD");
    const { v: iv, etag } = await getVersion(v.id);
    expect(problem(await transition(v.id, etag, { action: "APPROVE", reason: "self", expectedContentHash: iv.contentHash }, "DESIGN_HEAD")).code).toBe("SEPARATION_OF_DUTIES");
  });
  it("transitions require an Idempotency-Key and If-Match; SUPERSEDE cannot be requested", async () => {
    const v = VersionResponse.parse((await newVersion()).json());
    const { etag } = await getVersion(v.id);
    expect((await api.request({ method: "POST", url: `/api/v1/design-versions/${v.id}/transitions`, as: as("DESIGNER"), payload: { action: "SUBMIT", reason: "x" }, headers: { "if-match": etag } })).statusCode).toBe(428);
    expect((await api.request({ method: "POST", url: `/api/v1/design-versions/${v.id}/transitions`, as: as("DESIGNER"), payload: { action: "SUBMIT", reason: "x" }, headers: { "idempotency-key": key() } })).statusCode).toBe(428);
    expect((await transition(v.id, etag, { action: "SUPERSEDE", reason: "x" })).statusCode).toBe(400);
  });
});

describe("tenant and project isolation", () => {
  it("another organization, or an unassigned member, cannot see or touch a version", async () => {
    const v = VersionResponse.parse((await newVersion()).json());
    const other = await world();
    expect((await api.request({ method: "GET", url: `/api/v1/design-versions/${v.id}`, as: other.users.DESIGN_HEAD })).statusCode).toBe(404);
    expect((await api.request({ method: "GET", url: `/api/v1/design-versions/${v.id}`, as: as("COSTING") })).statusCode).toBe(404);
    const { etag } = await getVersion(v.id);
    const r = await api.request({ method: "POST", url: `/api/v1/design-versions/${v.id}/objects`, as: other.users.DESIGNER, payload: cabinet(productVersionId), headers: { "if-match": etag } });
    expect(r.statusCode).toBe(404);
  });
});
