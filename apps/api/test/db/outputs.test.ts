/**
 * Output generation over HTTP (M5 Step 7 checkpoint 2): BOM → BOQ → Pricing → Quotation from ONE execution context,
 * exact upstream snapshots by natural identity (never "latest"), OUTPUT_GENERATION evidence, reuse / idempotency,
 * staleness, explicit reproduction, purposes × lifecycle, commercial provenance, permissions and tenancy.
 *
 * Data: the committed race-database world (tests/db builders: synthetic test-only reference values). Its engineering
 * data is deliberately incomplete, so the real engines report BLOCKERs and pricing is UNAVAILABLE — nothing here is
 * priced, and no production rate, Hettich record or ManufacturingStandard value is invented.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Tx } from "../../../../tests/db/support/db.js";
import { hashOf, pricingStandard, transition, validationRun, approve as approveVersion } from "../../../../tests/db/support/world.js";
import { computeEngineManifest } from "../../src/infrastructure/engines/engine-manifest.build.js";
import { VersionResponse } from "../../src/modules/design-versions/design-versions.schemas.js";
import type * as ValidationEntry from "../../src/modules/outputs/engines/validation.js";
import { DetailedStaleness, GenerateResponse, Snapshot, UnavailableResponse } from "../../src/modules/outputs/outputs.schemas.js";
import type { DomainWorld } from "../support/domain.js";
import { cabinet, domainWorld, key } from "../support/domain.js";
import type { Api, Problem } from "../support/harness.js";
import { admin, sql, startApi, TEST_BUILD, world } from "../support/harness.js";

/** Counts room resolutions: one generation request must resolve the room exactly once (Clarification A). */
const resolutions = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../src/modules/outputs/engines/validation.js", async (importOriginal) => {
  const m = await importOriginal<typeof ValidationEntry>();
  return {
    ...m,
    resolveEngineeringModel: (model: Parameters<typeof m.resolveEngineeringModel>[0]) => {
      resolutions.count += 1;
      return m.resolveEngineeringModel(model);
    },
  };
});

let api: Api;
let d: DomainWorld;
let productVersionId: string;
const manifest = computeEngineManifest();
beforeAll(async () => {
  api = await startApi();
  d = await domainWorld(api, { commercial: "approved" });
  productVersionId = (d.deps.items.product as { versionId: string }).versionId;
  const m = await api.request({ method: "POST", url: `/api/v1/projects/${d.projectId}/members`, as: d.w.users.SALES, payload: { userId: d.w.users.COSTING, role: "COSTING" } });
  expect(m.statusCode).toBe(201);
});
afterAll(async () => {
  await api.close();
});

type Role = keyof DomainWorld["w"]["users"];
type Kind = "bom" | "boq" | "pricing" | "quotation";
const as = (role: Role) => d.w.users[role];
const problem = (r: { json: () => unknown }) => r.json() as Problem;
const pricingId = () => d.deps.commercial.pricing_standard_version_id as string;
const policyId = () => d.deps.commercial.quotation_policy_version_id as string;

const generate = (kind: Kind, versionId: string, payload: Record<string, unknown> = {}, role: Role = "DESIGNER", k = key()) =>
  api.request({ method: "POST", url: `/api/v1/design-versions/${versionId}/${kind}-snapshots`, as: as(role), payload, headers: { "idempotency-key": k } });
const read = (path: string, role: Role = "DESIGNER") => api.request({ method: "GET", url: `/api/v1/${path}`, as: as(role) });
const created = (r: Awaited<ReturnType<typeof generate>>, status = 201) => {
  expect([r.statusCode, r.statusCode >= 400 ? problem(r).code : "ok"]).toEqual([status, "ok"]);
  return GenerateResponse.parse(r.json());
};

async function version(objects = 1): Promise<{ id: string; etag: string }> {
  const v = VersionResponse.parse((await api.request({ method: "POST", url: `/api/v1/designs/${d.designId}/versions`, as: as("DESIGNER"), headers: { "idempotency-key": key() }, payload: { pins: d.pins, changeReason: "outputs" } })).json());
  let etag = (await read(`design-versions/${v.id}`)).headers.etag as string;
  for (let i = 0; i < objects; i++) {
    const o = await api.request({ method: "POST", url: `/api/v1/design-versions/${v.id}/objects`, as: as("DESIGNER"), payload: cabinet(productVersionId, `OBJ-KIT-00${String(i + 1)}`, i * 600), headers: { "if-match": etag } });
    expect(o.statusCode).toBe(201);
    etag = o.headers.etag as string;
  }
  return { id: v.id, etag };
}
const versionRow = async (id: string) => (await sql<{ status: string; row_version: number; input_revision: number; input_hash: string }>("SELECT status, row_version, input_revision, input_hash FROM design_os.design_version WHERE id = $1", [id]))[0];
const outputRuns = async (id: string) => sql<{ id: string; blocker_count: number; engine_fingerprint: string; engine_build: string }>("SELECT id, blocker_count, engine_fingerprint, engine_build FROM design_os.validation_run WHERE design_version_id = $1 AND purpose = 'OUTPUT_GENERATION'", [id]);
const rows = async (table: string, id: string) => sql<{ id: string; validation_run_id: string; created_at: string; bom_snapshot_id?: string }>(`SELECT * FROM design_os.${table} WHERE design_version_id = $1 ORDER BY created_at, id`, [id]);

/** Seeded APPROVAL evidence (test engine, 0 BLOCKERs) and the lifecycle transitions, through the database's own paths. */
async function seedApproved(versionId: string): Promise<void> {
  const c = await admin();
  try {
    await c.query("BEGIN");
    const tx = c as unknown as Tx;
    const v = await versionRow(versionId);
    await validationRun(tx, d.w, versionId, v?.input_hash as string, 0);
    await transition(tx, d.w, "DESIGNER", "design", versionId, "SUBMIT");
    await transition(tx, d.w, "DESIGN_HEAD", "design", versionId, "APPROVE", "approved", await hashOf(tx, "design", versionId));
    await c.query("COMMIT");
  } finally {
    await c.end();
  }
}

describe("one execution context: validation → BOM, recorded together", () => {
  it("a BOM records the exact inputs, the bom engine, and the OUTPUT_GENERATION run of the same context (BLOCKERs propagated); the design is never changed", async () => {
    const v = await version();
    const before = await versionRow(v.id);
    const approval = (await api.request({ method: "POST", url: `/api/v1/design-versions/${v.id}/validation-runs`, as: as("DESIGNER"), payload: {}, headers: { "idempotency-key": key() } })).json<{ blockerCount: number; warningCount: number }>();
    const r = created(await generate("bom", v.id));
    const s = r.snapshot;
    expect(r.reused).toBe(false);
    expect(s).toMatchObject({
      kind: "BOM", purpose: "PRELIMINARY", designVersionId: v.id, designVersionStatus: "DRAFT", input: { hash: before?.input_hash, revision: before?.input_revision },
      commercial: null, sources: {}, dataClassification: "PRODUCTION", qualifiesForIssue: false, qualifiesForRelease: false,
      engine: { name: "bom", version: "0.1.0", build: TEST_BUILD, fingerprint: manifest.engines.bom?.fingerprint, closure: manifest.engines.bom?.closure, seal: null },
      validationRun: { purpose: "OUTPUT_GENERATION", engine: { name: "validation", build: TEST_BUILD, fingerprint: manifest.engines.validation?.fingerprint } },
      staleness: { stale: false, reasons: [] },
    });
    // The engine is the authority: the same inputs give the same validation; its BLOCKERs are carried into the output.
    expect([s.validationRun.blockerCount, s.validationRun.warningCount]).toEqual([approval.blockerCount, approval.warningCount]);
    expect(s.blockerCount).toBe(s.validationRun.blockerCount);
    expect(s.blockerCount).toBeGreaterThan(0);
    expect(s.outputComplete).toBe(!(s.payload as { incomplete: boolean }).incomplete);
    // Engineering dependency content only: the 8 non-null pins, no commercial version.
    expect(Object.keys(s.dependencyHashes).sort()).toEqual(Object.entries(d.deps.pins).filter(([, id]) => id !== null).map(([pin]) => pin).sort());
    const runs = await outputRuns(v.id);
    expect(runs).toEqual([{ id: s.validationRun.id, blocker_count: s.validationRun.blockerCount, engine_fingerprint: manifest.engines.validation?.fingerprint, engine_build: TEST_BUILD }]);
    expect(await versionRow(v.id)).toEqual(before);
    expect(r.dependencies).toEqual([]);
  });

  it("a Pricing request builds BOM → BOQ from ONE context (one room resolution, one run, one timestamp); UNAVAILABLE pricing is not persisted", async () => {
    const v = await version();
    const resolvedBefore = resolutions.count;
    const r = await generate("pricing", v.id, { pricingStandardVersionId: pricingId() }, "COSTING");
    expect(r.statusCode).toBe(200);
    const u = UnavailableResponse.parse(r.json());
    expect(resolutions.count - resolvedBefore).toBe(1);
    expect(u).toMatchObject({ status: "UNAVAILABLE", kind: "PRICING", snapshot: null });
    // Structured engine blockers, never a zero price; the synthetic world is not a production design.
    expect(u.blockers.map((b) => b.code)).toContain("PRICING_DESIGN_BLOCKED");
    expect(u.blockers.every((b) => b.severity === "BLOCKER")).toBe(true);
    expect(u.dependencies.map((x) => x.kind)).toEqual(["BOM", "BOQ"]);
    const [bom] = await rows("bom_snapshot", v.id);
    const [boq] = await rows("boq_snapshot", v.id);
    const runs = await outputRuns(v.id);
    expect(runs).toHaveLength(1);
    expect([bom?.validation_run_id, boq?.validation_run_id]).toEqual([runs[0]?.id, runs[0]?.id]);
    expect(boq?.bom_snapshot_id).toBe(bom?.id);
    expect(boq?.created_at).toBe(bom?.created_at);
    expect(await rows("pricing_snapshot", v.id)).toEqual([]);

    // Again, nothing new to insert: nothing is recorded at all (no orphan OUTPUT_GENERATION run, no snapshot).
    const again = UnavailableResponse.parse((await generate("pricing", v.id, { pricingStandardVersionId: pricingId() }, "COSTING")).json());
    expect(again.dependencies.map((x) => x.id)).toEqual(u.dependencies.map((x) => x.id));
    expect(await outputRuns(v.id)).toEqual(runs);
    expect((await rows("bom_snapshot", v.id)).length + (await rows("boq_snapshot", v.id)).length).toBe(2);
  });

  it("a Quotation request resolves Pricing first; Pricing UNAVAILABLE makes the quotation UNAVAILABLE and nothing commercial is stored", async () => {
    const v = await version();
    const r = UnavailableResponse.parse((await generate("quotation", v.id, { pricingStandardVersionId: pricingId(), quotationPolicyVersionId: policyId() }, "COSTING")).json());
    expect([r.status, r.kind]).toEqual(["UNAVAILABLE", "PRICING"]);
    expect(await rows("pricing_snapshot", v.id)).toEqual([]);
    expect(await rows("quotation_snapshot", v.id)).toEqual([]);
  });
});

describe("reuse and idempotency", () => {
  it("the same inputs reuse the exact snapshot (200, reused); the same key replays; the same key with another body is refused", async () => {
    const v = await version();
    const k = key();
    const first = created(await generate("bom", v.id, {}, "DESIGNER", k));
    const reused = created(await generate("bom", v.id), 200);
    expect([reused.reused, reused.snapshot.id, reused.snapshot.contentHash]).toEqual([true, first.snapshot.id, first.snapshot.contentHash]);
    const replay = await generate("bom", v.id, {}, "DESIGNER", k);
    expect([replay.statusCode, replay.headers["idempotent-replayed"]]).toEqual([201, "true"]);
    expect(GenerateResponse.parse(replay.json()).snapshot.id).toBe(first.snapshot.id);
    expect(problem(await generate("bom", v.id, { purpose: "FOR_REVIEW" }, "DESIGNER", k)).code).toBe("IDEMPOTENCY_CONFLICT");
    expect(await rows("bom_snapshot", v.id)).toHaveLength(1);
    expect(await outputRuns(v.id)).toHaveLength(1);
  });

  it("a result stored only by reference (too large to store) is replayed from the immutable snapshot, with the same body", async () => {
    const v = await version();
    const k = key();
    const first = await generate("boq", v.id, {}, "DESIGNER", k);
    expect(first.statusCode).toBe(201);
    const id = GenerateResponse.parse(first.json()).snapshot.id;
    // Every generation stores its durable resource reference; drop the stored body as a > 60 KB result would have none.
    // (Test-only: the completed record is immutable, so its guard trigger is bypassed in this admin session.)
    const c = await admin();
    let record: { resource_type: string; resource_id: string } | undefined;
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL session_replication_role = replica");
      record = (await c.query<{ resource_type: string; resource_id: string }>("UPDATE design_os.idempotency_record SET response_body = NULL WHERE idempotency_key = $1 RETURNING resource_type, resource_id", [k])).rows[0];
      await c.query("COMMIT");
    } finally {
      await c.end();
    }
    expect(record).toEqual({ resource_type: "boq_snapshot", resource_id: id });
    const replay = await generate("boq", v.id, {}, "DESIGNER", k);
    expect([replay.statusCode, replay.headers["idempotent-replayed"]]).toEqual([201, "true"]);
    expect(replay.json()).toEqual(first.json());
  });

  it("a request can never carry results, hashes, counts or 'latest'", async () => {
    const v = await version();
    for (const payload of [{ blockerCount: 0 }, { contentHash: `sha256:${"a".repeat(64)}` }, { payload: {} }, { latest: true }, { pricingStandardVersionId: pricingId() }]) {
      expect([JSON.stringify(payload), (await generate("bom", v.id, payload)).statusCode]).toEqual([JSON.stringify(payload), 400]);
    }
    expect((await generate("pricing", v.id, {}, "COSTING")).statusCode).toBe(400);
    expect((await generate("quotation", v.id, { pricingStandardVersionId: pricingId() }, "COSTING")).statusCode).toBe(400);
  });
});

describe("staleness and exact upstream regeneration", () => {
  it("after an input change the old BOM is stale (with the changed objects); a BOQ request generates a new BOM first and consumes exactly it", async () => {
    const v = await version();
    const old = created(await generate("bom", v.id));
    const o = await api.request({ method: "POST", url: `/api/v1/design-versions/${v.id}/objects`, as: as("DESIGNER"), payload: cabinet(productVersionId, "OBJ-LATE", 600), headers: { "if-match": v.etag } });
    expect(o.statusCode).toBe(201);
    const stale = Snapshot.parse((await read(`bom-snapshots/${old.snapshot.id}`)).json());
    expect(stale.staleness).toMatchObject({ stale: true, reasons: ["ENGINEERING_INPUTS_CHANGED"] });
    const detailed = DetailedStaleness.parse((await read(`bom-snapshots/${old.snapshot.id}/staleness`)).json());
    expect(detailed.model.stale).toBe(true);
    const late = await sql<{ id: string }>("SELECT lineage_id AS id FROM design_os.design_object WHERE design_version_id = $1 AND object_code = 'OBJ-LATE'", [v.id]);
    expect(detailed.model.changedObjectIds).toEqual(late.map((x) => x.id));

    const boq = created(await generate("boq", v.id));
    const [fresh] = boq.dependencies;
    expect(fresh?.kind).toBe("BOM");
    expect(fresh?.id).not.toBe(old.snapshot.id);
    expect(boq.snapshot.sources).toEqual({ bomSnapshotId: fresh?.id });
    expect(boq.snapshot.staleness.stale).toBe(false);
    // Never overwritten: the old snapshot is intact.
    expect(Snapshot.parse((await read(`bom-snapshots/${old.snapshot.id}`)).json()).contentHash).toBe(old.snapshot.contentHash);
    // Downstream of a stale source is stale too (SOURCE_STALE), and lists show the envelope without payloads.
    const list = (await read(`design-versions/${v.id}/bom-snapshots`)).json<{ items: Record<string, unknown>[] }>().items;
    expect(list.map((x) => [x.id, (x.staleness as { stale: boolean }).stale])).toEqual([[fresh?.id, false], [old.snapshot.id, true]]);
    expect(list.every((x) => !("payload" in x))).toBe(true);
  });
});

describe("explicit reproduction sources", () => {
  it("a named source must be an intact snapshot of exactly these inputs with an equal or stronger purpose", async () => {
    const v = await version();
    const other = await version();
    const otherBom = created(await generate("bom", other.id));
    const bom = created(await generate("bom", v.id));
    const incompatible = await generate("boq", v.id, { sources: { bomSnapshotId: otherBom.snapshot.id } });
    expect([incompatible.statusCode, problem(incompatible).code, problem(incompatible).context]).toEqual([409, "SOURCE_SNAPSHOT_INCOMPATIBLE", { source: "bomSnapshotId" }]);
    const unknown = await generate("boq", v.id, { sources: { bomSnapshotId: crypto.randomUUID() } });
    expect([unknown.statusCode, problem(unknown).code]).toEqual([422, "INVALID_REFERENCE"]);
    const named = created(await generate("boq", v.id, { sources: { bomSnapshotId: bom.snapshot.id } }));
    expect(named.snapshot.sources).toEqual({ bomSnapshotId: bom.snapshot.id });
    // Server resolution finds the same BOM by natural identity: the BOQ is reused.
    expect((created(await generate("boq", v.id), 200)).snapshot.id).toBe(named.snapshot.id);

    await seedApproved(v.id);
    const weaker = await generate("boq", v.id, { purpose: "FOR_REVIEW", sources: { bomSnapshotId: bom.snapshot.id } });
    expect([weaker.statusCode, problem(weaker).code]).toEqual([409, "SOURCE_PURPOSE_INSUFFICIENT"]);
  });
});

describe("purposes × lifecycle (refused before anything is recorded)", () => {
  it("DRAFT: PRELIMINARY only", async () => {
    const v = await version();
    const review = await generate("bom", v.id, { purpose: "FOR_REVIEW" });
    expect([review.statusCode, problem(review).code]).toEqual([409, "OUTPUT_PURPOSE_NOT_ALLOWED"]);
    const production = await generate("bom", v.id, { purpose: "FOR_PRODUCTION" });
    expect([production.statusCode, problem(production).code]).toEqual([409, "PRODUCTION_GUARD_FAILED"]);
    expect(await outputRuns(v.id)).toEqual([]);
  });

  it("APPROVED: FOR_PRODUCTION needs 0 BLOCKERs from the RUNNING build on these inputs (older approval evidence is not enough); SUPERSEDED: review / reproduction only", async () => {
    const v = await version();
    await seedApproved(v.id);
    expect((await versionRow(v.id))?.status).toBe("APPROVED");
    const production = await generate("bom", v.id, { purpose: "FOR_PRODUCTION" });
    expect([production.statusCode, problem(production).code]).toEqual([409, "VALIDATION_BLOCKERS"]);
    expect(await outputRuns(v.id)).toEqual([]);
    const review = created(await generate("boq", v.id, { purpose: "FOR_REVIEW" }));
    expect(review.dependencies.map((x) => [x.kind, x.purpose])).toEqual([["BOM", "FOR_REVIEW"]]);

    // Approving a successor supersedes v (the only path to SUPERSEDED).
    const next = VersionResponse.parse((await api.request({ method: "POST", url: `/api/v1/designs/${d.designId}/versions`, as: as("DESIGNER"), headers: { "idempotency-key": key() }, payload: { basedOnVersionId: v.id, changeReason: "successor" } })).json());
    await seedApproved(next.id);
    const before = await versionRow(v.id);
    expect(before?.status).toBe("SUPERSEDED");
    const reproduced = created(await generate("bom", v.id, { purpose: "FOR_REVIEW" }), 200);
    expect(reproduced.snapshot).toMatchObject({ designVersionStatus: "APPROVED", staleness: { stale: false, advisories: { designSuperseded: true } } });
    const prelim = created(await generate("bom", v.id, { purpose: "PRELIMINARY" }));
    expect(prelim.snapshot.designVersionStatus).toBe("SUPERSEDED");
    const runs = await outputRuns(v.id);
    const refused = await generate("boq", v.id, { purpose: "FOR_PRODUCTION" });
    expect([refused.statusCode, problem(refused).code]).toEqual([409, "PRODUCTION_GUARD_FAILED"]);
    expect(await outputRuns(v.id)).toEqual(runs);
    expect(await versionRow(v.id)).toEqual(before);
  });
});

describe("commercial provenance: chosen per output, never pinned", () => {
  it("unknown or foreign commercial versions are refused (422) before anything is recorded", async () => {
    const v = await version();
    const foreign = await domainWorld(api, { commercial: "approved" });
    const r = await generate("pricing", v.id, { pricingStandardVersionId: foreign.deps.commercial.pricing_standard_version_id }, "COSTING");
    expect([r.statusCode, problem(r).code, problem(r).errors?.map((e) => e.path)]).toEqual([422, "COMMERCIAL_VERSION_NOT_FOUND", ["body.pricingStandardVersionId"]]);
    const q = await generate("quotation", v.id, { pricingStandardVersionId: pricingId(), quotationPolicyVersionId: crypto.randomUUID() }, "COSTING");
    expect([q.statusCode, problem(q).code]).toEqual([422, "COMMERCIAL_VERSION_NOT_FOUND"]);
    expect(await outputRuns(v.id)).toEqual([]);
  });

  it("a new PricingStandard version never creates a design version and never stales engineering outputs: the same BOM / BOQ are reused", async () => {
    const v = await version();
    const first = UnavailableResponse.parse((await generate("pricing", v.id, { pricingStandardVersionId: pricingId() }, "COSTING")).json());
    const c = await admin();
    let next: string;
    try {
      await c.query("BEGIN");
      const tx = c as unknown as Tx;
      const entity = (await c.query<{ entity_id: string }>("SELECT entity_id FROM design_os.pricing_standard_version WHERE id = $1", [pricingId()])).rows[0]?.entity_id as string;
      next = await pricingStandard(tx, d.w, { complete: true, entityId: entity, versionNumber: 2 });
      await approveVersion(tx, d.w, "pricing_standard", next);
      await c.query("COMMIT");
    } finally {
      await c.end();
    }
    const versions = await sql("SELECT id FROM design_os.design_version WHERE entity_id = $1", [d.designId]);
    const second = UnavailableResponse.parse((await generate("pricing", v.id, { pricingStandardVersionId: next }, "COSTING")).json());
    expect(second.dependencies).toEqual(first.dependencies);
    expect(await sql("SELECT id FROM design_os.design_version WHERE entity_id = $1", [d.designId])).toEqual(versions);
    const bom = Snapshot.parse((await read(`bom-snapshots/${first.dependencies[0]?.id ?? ""}`, "COSTING")).json());
    expect(bom.staleness.stale).toBe(false);
  });

  it("a DRAFT PricingStandard is gated by the engine: UNAVAILABLE, never a price", async () => {
    const v = await version();
    const c = await admin();
    let draft: string;
    try {
      await c.query("BEGIN");
      const entity = (await c.query<{ entity_id: string }>("SELECT entity_id FROM design_os.pricing_standard_version WHERE id = $1", [pricingId()])).rows[0]?.entity_id as string;
      const n = (await c.query<{ n: number }>("SELECT max(version_number)::int + 1 AS n FROM design_os.pricing_standard_version WHERE entity_id = $1", [entity])).rows[0]?.n ?? 2;
      draft = await pricingStandard(c as unknown as Tx, d.w, { complete: true, entityId: entity, versionNumber: n });
      await c.query("COMMIT");
    } finally {
      await c.end();
    }
    const r = UnavailableResponse.parse((await generate("pricing", v.id, { pricingStandardVersionId: draft }, "COSTING")).json());
    expect(r.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(["PRICING_RATE_CARD_NOT_APPROVED", "PRICING_RULES_NOT_APPROVED"]));
  });
});

describe("permissions and tenancy (orchestration never escalates)", () => {
  it("each output needs its own action; reads need the read action; another organization sees nothing", async () => {
    const v = await version();
    expect(problem(await generate("pricing", v.id, { pricingStandardVersionId: pricingId() }, "DESIGNER")).code).toBe("PERMISSION_DENIED");
    expect(problem(await generate("bom", v.id, {}, "SITE_ENGINEER")).code).toBe("PERMISSION_DENIED");
    const bom = created(await generate("bom", v.id));
    expect((await read(`bom-snapshots/${bom.snapshot.id}`, "COSTING")).statusCode).toBe(200);
    expect(problem(await read(`design-versions/${v.id}/pricing-snapshots`, "DESIGNER")).code).toBe("PERMISSION_DENIED");
    const other = await world();
    expect((await api.request({ method: "GET", url: `/api/v1/bom-snapshots/${bom.snapshot.id}`, as: other.users.DESIGN_HEAD })).statusCode).toBe(404);
    expect((await api.request({ method: "POST", url: `/api/v1/design-versions/${v.id}/bom-snapshots`, as: other.users.DESIGN_HEAD, payload: {}, headers: { "idempotency-key": key() } })).statusCode).toBe(404);
  });

  it("a commercial caller without output.generate.engineering cannot create a missing BOM (403 naming the action), but may use existing ones", async () => {
    const own = await domainWorld(api, { commercial: "approved" });
    const m = await api.request({ method: "POST", url: `/api/v1/projects/${own.projectId}/members`, as: own.w.users.SALES, payload: { userId: own.w.users.COSTING, role: "COSTING" } });
    expect(m.statusCode).toBe(201);
    await sql("DELETE FROM design_os.role_permission WHERE org_id = $1 AND role = 'COSTING' AND action = 'output.generate.engineering'", [own.w.org]);
    const pv = (own.deps.items.product as { versionId: string }).versionId;
    const v = VersionResponse.parse((await api.request({ method: "POST", url: `/api/v1/designs/${own.designId}/versions`, as: own.w.users.DESIGNER, headers: { "idempotency-key": key() }, payload: { pins: own.pins, changeReason: "x" } })).json());
    const etag = (await api.request({ method: "GET", url: `/api/v1/design-versions/${v.id}`, as: own.w.users.DESIGNER })).headers.etag as string;
    await api.request({ method: "POST", url: `/api/v1/design-versions/${v.id}/objects`, as: own.w.users.DESIGNER, payload: cabinet(pv), headers: { "if-match": etag } });
    const price = (who: string) => api.request({ method: "POST", url: `/api/v1/design-versions/${v.id}/pricing-snapshots`, as: who, payload: { pricingStandardVersionId: own.deps.commercial.pricing_standard_version_id }, headers: { "idempotency-key": key() } });
    const denied = await price(own.w.users.COSTING);
    expect([denied.statusCode, problem(denied).code, problem(denied).context]).toEqual([403, "PERMISSION_DENIED", { requiredAction: "output.generate.engineering" }]);
    expect((await sql("SELECT id FROM design_os.bom_snapshot WHERE design_version_id = $1", [v.id]))).toEqual([]);
    // Once engineering outputs exist (generated by a designer), the commercial caller uses them.
    for (const kind of ["bom", "boq"]) {
      expect((await api.request({ method: "POST", url: `/api/v1/design-versions/${v.id}/${kind}-snapshots`, as: own.w.users.DESIGNER, payload: {}, headers: { "idempotency-key": key() } })).statusCode).toBe(201);
    }
    expect(UnavailableResponse.parse((await price(own.w.users.COSTING)).json()).dependencies.map((x) => x.kind)).toEqual(["BOM", "BOQ"]);
  });
});
