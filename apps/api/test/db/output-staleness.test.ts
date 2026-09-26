/**
 * Output staleness over HTTP (Step 6 plan §10), against the committed race database:
 *  A. ENGINE_CHANGED — an output of build A read by a deployment whose engine code differs (build B);
 *  B. DEPENDENCY_CONTENT_CHANGED — the content of a DRAFT pinned dependency changes after generation;
 *  C. a newer approved version of a pinned dependency never stales an output (advisory only);
 *  D. a SUPERSEDED design's historical outputs stay reproducible and are never FOR_PRODUCTION eligible.
 * Synthetic test-only reference data (tests/db builders); nothing is priced, nothing production is invented.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "../../../../tests/db/support/db.js";
import { approve as approveVersion, constructionStandard, hashOf, transition, validationRun } from "../../../../tests/db/support/world.js";
import type { EngineManifestEntry } from "../../src/infrastructure/engines/engine-manifest.js";
import { engineFingerprint } from "../../src/infrastructure/engines/engine-manifest.js";
import { computeEngineManifest } from "../../src/infrastructure/engines/engine-manifest.build.js";
import { VersionResponse } from "../../src/modules/design-versions/design-versions.schemas.js";
import { GenerateResponse, Snapshot } from "../../src/modules/outputs/outputs.schemas.js";
import type { DomainWorld } from "../support/domain.js";
import { cabinet, domainWorld, key } from "../support/domain.js";
import type { Api, Problem } from "../support/harness.js";
import { admin, sql, startApi, TEST_BUILD } from "../support/harness.js";

let api: Api;
let d: DomainWorld;
let productVersionId: string;
beforeAll(async () => {
  api = await startApi();
  d = await domainWorld(api, { commercial: "approved" });
  productVersionId = (d.deps.items.product as { versionId: string }).versionId;
  expect((await api.request({ method: "POST", url: `/api/v1/projects/${d.projectId}/members`, as: d.w.users.SALES, payload: { userId: d.w.users.COSTING, role: "COSTING" } })).statusCode).toBe(201);
});
afterAll(async () => {
  await api.close();
});

type Role = keyof DomainWorld["w"]["users"];
const as = (role: Role) => d.w.users[role];
const problem = (r: { json: () => unknown }) => r.json() as Problem;
const generate = (on: Api, kind: "bom" | "boq" | "pricing", versionId: string, payload: Record<string, unknown> = {}, role: Role = "DESIGNER") =>
  on.request({ method: "POST", url: `/api/v1/design-versions/${versionId}/${kind}-snapshots`, as: as(role), payload, headers: { "idempotency-key": key() } });
const generated = (r: Awaited<ReturnType<typeof generate>>, status = 201) => {
  expect([r.statusCode, r.statusCode >= 400 ? problem(r).code : "ok"]).toEqual([status, "ok"]);
  return GenerateResponse.parse(r.json());
};
const snapshot = async (on: Api, kind: "bom" | "boq", id: string) => Snapshot.parse((await on.request({ method: "GET", url: `/api/v1/${kind}-snapshots/${id}`, as: as("DESIGNER") })).json());

async function seeded<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const c = await admin();
  try {
    await c.query("BEGIN");
    const r = await fn(c as unknown as Tx);
    await c.query("COMMIT");
    return r;
  } finally {
    await c.end();
  }
}

async function version(pins: Record<string, string | null> = d.pins, basedOnVersionId?: string): Promise<string> {
  const payload = basedOnVersionId === undefined ? { pins, changeReason: "staleness" } : { basedOnVersionId, changeReason: "successor" };
  const created = await api.request({ method: "POST", url: `/api/v1/designs/${d.designId}/versions`, as: as("DESIGNER"), headers: { "idempotency-key": key() }, payload });
  expect(created.statusCode).toBe(201);
  const v = VersionResponse.parse(created.json());
  if (basedOnVersionId !== undefined) return v.id;
  const etag = (await api.request({ method: "GET", url: `/api/v1/design-versions/${v.id}`, as: as("DESIGNER") })).headers.etag as string;
  expect((await api.request({ method: "POST", url: `/api/v1/design-versions/${v.id}/objects`, as: as("DESIGNER"), payload: cabinet(productVersionId), headers: { "if-match": etag } })).statusCode).toBe(201);
  return v.id;
}

/** Seeded APPROVAL evidence (test engine, 0 BLOCKERs) + SUBMIT / APPROVE through design_os.transition. */
const seedApproved = (versionId: string) => seeded(async (tx) => {
  const [v] = await sql<{ input_hash: string }>("SELECT input_hash FROM design_os.design_version WHERE id = $1", [versionId]);
  await validationRun(tx, d.w, versionId, v?.input_hash as string, 0);
  await transition(tx, d.w, "DESIGNER", "design", versionId, "SUBMIT");
  await transition(tx, d.w, "DESIGN_HEAD", "design", versionId, "APPROVE", "approved", await hashOf(tx, "design", versionId));
});

const constructionEntity = async () => (await sql<{ entity_id: string; n: number }>(
  "SELECT entity_id, (SELECT max(version_number)::int + 1 FROM design_os.construction_standard_version x WHERE x.entity_id = v.entity_id) AS n FROM design_os.construction_standard_version v WHERE id = $1",
  [d.pins.constructionStandardVersionId]))[0] as { entity_id: string; n: number };

describe("A. ENGINE_CHANGED: build A's output read by build B", () => {
  it("another build of the same engine code is not staleness; changed engine code is (ENGINE_CHANGED, and SOURCE_STALE downstream); build B regenerates", async () => {
    const v = await version();
    const boq = generated(await generate(api, "boq", v));
    const bomId = boq.snapshot.sources.bomSnapshotId as string;
    const a = computeEngineManifest();
    const dir = mkdtempSync(join(tmpdir(), "engine-manifest-b-"));

    // Build B, same engine code: the build is recorded beside the fingerprint, never an input of it.
    const sameCode = join(dir, "same-code.json");
    writeFileSync(sameCode, JSON.stringify(a));
    const rebuilt = await startApi([], { buildRevision: "build-b-0000001", engineManifestPath: sameCode });
    try {
      const s = await snapshot(rebuilt, "bom", bomId);
      expect([s.engine.build, s.staleness.stale]).toEqual([TEST_BUILD, false]);
    } finally {
      await rebuilt.close();
    }

    // Build B with changed BOM engine code: another closure → another fingerprint (a verified manifest).
    const bomA = a.engines.bom as EngineManifestEntry;
    const closure = { ...bomA.closure, packages: { ...bomA.closure.packages, "@lintel/bom-engine": `sha256:${"b".repeat(64)}` as const } };
    const bomB = { ...bomA, closure, fingerprint: engineFingerprint({ ...bomA, closure }) };
    const changedCode = join(dir, "changed-code.json");
    writeFileSync(changedCode, JSON.stringify({ ...a, engines: { ...a.engines, bom: bomB } }));
    const buildB = await startApi([], { buildRevision: "build-b-0000002", engineManifestPath: changedCode });
    try {
      const bom = await snapshot(buildB, "bom", bomId);
      expect(bom.staleness).toMatchObject({ stale: true, reasons: ["ENGINE_CHANGED"] });
      expect(bom.engine.fingerprint).toBe(bomA.fingerprint);
      // The BOQ engine did not change, but its BOM source is stale.
      expect((await snapshot(buildB, "boq", boq.snapshot.id)).staleness).toMatchObject({ stale: true, reasons: ["SOURCE_STALE"] });
      // Build B generates a new BOM with its own engine first, and a new BOQ consuming exactly it; nothing is overwritten.
      const next = generated(await generate(buildB, "boq", v));
      const newBomId = next.snapshot.sources.bomSnapshotId as string;
      expect(newBomId).not.toBe(bomId);
      expect((await snapshot(buildB, "bom", newBomId)).engine).toMatchObject({ build: "build-b-0000002", fingerprint: bomB.fingerprint });
      expect(next.snapshot.staleness.stale).toBe(false);
      expect((await snapshot(api, "bom", bomId)).contentHash).toBe(bom.contentHash);
    } finally {
      await buildB.close();
    }
    // Build A still considers its own output current.
    expect((await snapshot(api, "bom", bomId)).staleness.stale).toBe(false);
  });
});

describe("B. DEPENDENCY_CONTENT_CHANGED: a DRAFT pinned dependency changes", () => {
  it("the output records the DRAFT version's content hash; a later change to that content makes it stale (inputs unchanged)", async () => {
    const e = await constructionEntity();
    const draft = await seeded((tx) => constructionStandard(tx, d.w, { complete: true, entityId: e.entity_id, versionNumber: e.n }));
    const v = await version({ ...d.pins, constructionStandardVersionId: draft });
    const bom = generated(await generate(api, "bom", v));
    expect(bom.snapshot.engineeringPins.constructionStandardVersionId).toBe(draft);
    const recorded = bom.snapshot.dependencyHashes.construction_standard_version_id;
    expect((await snapshot(api, "bom", bom.snapshot.id)).staleness.stale).toBe(false);

    // A DRAFT's child rows are editable (draft guard); the design version, its pins and input hash do not change.
    const before = await sql("SELECT input_hash, input_revision FROM design_os.design_version WHERE id = $1", [v]);
    const changed = await sql("UPDATE design_os.construction_standard_value SET value = value + 1 WHERE version_id = $1 AND variable_code = (SELECT min(variable_code) FROM design_os.construction_standard_value WHERE version_id = $1) RETURNING variable_code", [draft]);
    expect(changed).toHaveLength(1);
    expect(await sql("SELECT input_hash, input_revision FROM design_os.design_version WHERE id = $1", [v])).toEqual(before);

    const stale = await snapshot(api, "bom", bom.snapshot.id);
    expect(stale.staleness).toMatchObject({ stale: true, reasons: ["DEPENDENCY_CONTENT_CHANGED"] });
    expect(stale.dependencyHashes.construction_standard_version_id).toBe(recorded);
    // A new request consumes the new content: another dependency-set identity, so a new BOM.
    const next = generated(await generate(api, "bom", v));
    expect(next.snapshot.id).not.toBe(bom.snapshot.id);
    expect(next.snapshot.dependencyHashes.construction_standard_version_id).not.toBe(recorded);
  });
});

describe("C. a newer approved version never stales an output pinned to the older one", () => {
  it("the design stays pinned to V1; V2 is approved; the V1 output stays CURRENT with a newer-version advisory, and is still reused", async () => {
    const v = await version();
    const bom = generated(await generate(api, "bom", v));
    const e = await constructionEntity();
    const v2 = await seeded(async (tx) => {
      const id = await constructionStandard(tx, d.w, { complete: true, entityId: e.entity_id, versionNumber: e.n });
      await approveVersion(tx, d.w, "construction_standard", id);
      return id;
    });
    const s = await snapshot(api, "bom", bom.snapshot.id);
    expect(s.engineeringPins.constructionStandardVersionId).toBe(d.pins.constructionStandardVersionId);
    expect(s.staleness.stale).toBe(false);
    expect(s.staleness.reasons).toEqual([]);
    expect(s.staleness.advisories.newerDependencyVersions).toContainEqual({ pin: "construction_standard_version_id", versionId: v2 });
    expect((generated(await generate(api, "bom", v), 200)).snapshot.id).toBe(bom.snapshot.id);
  });
});

describe("D. SUPERSEDED design: historical outputs", () => {
  it("stay current and reproducible (reused by exact identity, usable as named sources) but are never FOR_PRODUCTION eligible", async () => {
    // Approval needs APPROVED / LOCKED dependencies: pin the construction standard version that is approved now.
    const [approved] = await sql<{ id: string }>("SELECT v.id FROM design_os.construction_standard_version v JOIN design_os.construction_standard_version p ON p.entity_id = v.entity_id WHERE p.id = $1 AND v.status = 'APPROVED'", [d.pins.constructionStandardVersionId]);
    const pins = { ...d.pins, constructionStandardVersionId: approved?.id ?? null };
    const v = await version(pins);
    await seedApproved(v);
    const boq = generated(await generate(api, "boq", v, { purpose: "FOR_REVIEW" }));
    const bomId = boq.snapshot.sources.bomSnapshotId as string;
    const successor = await version(pins, v);
    await seedApproved(successor);
    expect((await sql<{ status: string }>("SELECT status FROM design_os.design_version WHERE id = $1", [v]))[0]?.status).toBe("SUPERSEDED");
    const runs = async () => sql("SELECT id FROM design_os.validation_run WHERE design_version_id = $1 AND purpose = 'OUTPUT_GENERATION' ORDER BY id", [v]);
    const before = await runs();

    // Historically valid, not stale; flagged as superseded; never issuable.
    for (const [kind, id] of [["bom", bomId], ["boq", boq.snapshot.id]] as const) {
      const s = await snapshot(api, kind, id);
      expect([kind, s.purpose, s.designVersionStatus, s.qualifiesForIssue, s.staleness.stale, s.staleness.advisories.designSuperseded]).toEqual([kind, "FOR_REVIEW", "APPROVED", false, false, true]);
    }
    // Reproducible: the same request finds exactly the same outputs; the historical BOM can be named as the source.
    expect((generated(await generate(api, "boq", v, { purpose: "FOR_REVIEW" }), 200)).snapshot.id).toBe(boq.snapshot.id);
    expect((generated(await generate(api, "boq", v, { purpose: "FOR_REVIEW", sources: { bomSnapshotId: bomId } }), 200)).snapshot.id).toBe(boq.snapshot.id);
    expect(await runs()).toEqual(before);

    // Never FOR_PRODUCTION: refused before anything is recorded, for engineering and commercial outputs alike.
    for (const [kind, role, payload] of [["bom", "DESIGNER", {}], ["boq", "DESIGNER", {}], ["pricing", "COSTING", { pricingStandardVersionId: d.deps.commercial.pricing_standard_version_id }]] as const) {
      const r = await generate(api, kind, v, { purpose: "FOR_PRODUCTION", ...payload }, role);
      expect([kind, r.statusCode, problem(r).code]).toEqual([kind, 409, "PRODUCTION_GUARD_FAILED"]);
    }
    expect(await runs()).toEqual(before);
    expect(await sql("SELECT id FROM design_os.bom_snapshot WHERE design_version_id = $1 AND purpose = 'FOR_PRODUCTION' UNION ALL SELECT id FROM design_os.boq_snapshot WHERE design_version_id = $1 AND purpose = 'FOR_PRODUCTION'", [v])).toEqual([]);
  });
});
