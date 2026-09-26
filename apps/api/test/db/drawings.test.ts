/**
 * Drawing snapshots and files over HTTP (M5 Step 7 checkpoint 3): room-level and cabinet-level drawings from the
 * shared execution context, multi-file snapshots (one PDF + one SVG per sheet) sealed by a file manifest, content-
 * addressed storage (memory provider), short-lived signed URLs, the outputs graph and validation-run purposes.
 * Synthetic test-only reference data; the engines' BLOCKERs are carried and watermarked, never hidden.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "../../../../tests/db/support/db.js";
import { hashOf, transition, validationRun } from "../../../../tests/db/support/world.js";
import { computeEngineManifest } from "../../src/infrastructure/engines/engine-manifest.build.js";
import { ValidationRunResponse, VersionResponse } from "../../src/modules/design-versions/design-versions.schemas.js";
import { FileUrlResponse, GenerateResponse, OutputsGraph, Snapshot, SnapshotFiles, DetailedStaleness } from "../../src/modules/outputs/outputs.schemas.js";
import type { DomainWorld } from "../support/domain.js";
import { cabinet, domainWorld, key } from "../support/domain.js";
import type { Api, Problem } from "../support/harness.js";
import { admin, sql, startApi, TEST_BUILD, world } from "../support/harness.js";

let api: Api;
let d: DomainWorld;
let productVersionId: string;
const manifest = computeEngineManifest();
beforeAll(async () => {
  api = await startApi();
  d = await domainWorld(api, { commercial: "approved" });
  productVersionId = (d.deps.items.product as { versionId: string }).versionId;
  for (const role of ["COSTING", "DESIGN_HEAD"] as const) {
    expect((await api.request({ method: "POST", url: `/api/v1/projects/${d.projectId}/members`, as: d.w.users.SALES, payload: { userId: d.w.users[role], role } })).statusCode).toBe(201);
  }
});
afterAll(async () => {
  await api.close();
});

type Role = keyof DomainWorld["w"]["users"];
const as = (role: Role) => d.w.users[role];
const problem = (r: { json: () => unknown }) => r.json() as Problem;
const draw = (versionId: string, payload: Record<string, unknown>, role: Role = "DESIGNER", k = key()) =>
  api.request({ method: "POST", url: `/api/v1/design-versions/${versionId}/drawing-snapshots`, as: as(role), payload, headers: { "idempotency-key": k } });
const read = (path: string, role: Role = "DESIGNER") => api.request({ method: "GET", url: `/api/v1/${path}`, as: as(role) });
const generated = (r: Awaited<ReturnType<typeof draw>>, status = 201) => {
  expect([r.statusCode, r.statusCode >= 400 ? `${problem(r).code}: ${problem(r).detail ?? ""}` : "ok"]).toEqual([status, "ok"]);
  return GenerateResponse.parse(r.json());
};

async function version(objects = 1): Promise<{ id: string; lineageIds: string[] }> {
  const v = VersionResponse.parse((await api.request({ method: "POST", url: `/api/v1/designs/${d.designId}/versions`, as: as("DESIGNER"), headers: { "idempotency-key": key() }, payload: { pins: d.pins, changeReason: "drawings" } })).json());
  let etag = (await read(`design-versions/${v.id}`)).headers.etag as string;
  const lineageIds: string[] = [];
  for (let i = 0; i < objects; i++) {
    const o = await api.request({ method: "POST", url: `/api/v1/design-versions/${v.id}/objects`, as: as("DESIGNER"), payload: cabinet(productVersionId, `OBJ-KIT-00${String(i + 1)}`, i * 600), headers: { "if-match": etag } });
    expect(o.statusCode).toBe(201);
    etag = o.headers.etag as string;
  }
  // The engine object id of each cabinet is its lineage id (stable across copy-on-write versions).
  for (const r of await sql<{ lineage_id: string }>("SELECT lineage_id FROM design_os.design_object WHERE design_version_id = $1 ORDER BY object_code", [v.id])) lineageIds.push(r.lineage_id);
  return { id: v.id, lineageIds };
}
async function seedApproved(versionId: string): Promise<void> {
  const c = await admin();
  try {
    await c.query("BEGIN");
    const tx = c as unknown as Tx;
    const [v] = await sql<{ input_hash: string }>("SELECT input_hash FROM design_os.design_version WHERE id = $1", [versionId]);
    await validationRun(tx, d.w, versionId, v?.input_hash as string, 0);
    await transition(tx, d.w, "DESIGNER", "design", versionId, "SUBMIT");
    await transition(tx, d.w, "DESIGN_HEAD", "design", versionId, "APPROVE", "approved", await hashOf(tx, "design", versionId));
    await c.query("COMMIT");
  } finally {
    await c.end();
  }
}
/** Download a signed URL through the API's public content route (no Authorization header). */
async function download(url: string) {
  const u = new URL(url);
  return api.request({ method: "GET", url: `${u.pathname}${u.search}` });
}

describe("room-level drawings", () => {
  it("a wall internal elevation: engine drawing, title block from records, one PDF + one SVG per sheet sealed by the file manifest", async () => {
    const v = await version(2);
    const r = generated(await draw(v.id, { drawingType: "WALL_INTERNAL_ELEVATION", wallId: "A", drawingNumber: "KIT-WE-A", drawingRevision: "A" }));
    const s = r.snapshot;
    expect(s).toMatchObject({
      kind: "DRAWING", purpose: "PRELIMINARY", designVersionId: v.id, commercial: null, sources: {}, qualifiesForIssue: false,
      engine: { name: "drawing", build: TEST_BUILD, fingerprint: manifest.engines.drawing?.fingerprint },
      validationRun: { purpose: "OUTPUT_GENERATION" },
      drawing: { drawingType: "WALL_INTERNAL_ELEVATION", scope: "ROOM", wallId: "A", objectLineageId: null, cutXMm: null, drawingNumber: "KIT-WE-A", drawingRevision: "A" },
    });
    const payload = s.payload as { titleBlock: Record<string, string>; watermark: string | null; sheets: unknown[]; contentHash: string };
    expect(s.engine.seal).toBe(payload.contentHash);
    // Title block from records, never from the request: project code, room name, designer; no checker before approval.
    expect(payload.titleBlock).toMatchObject({ projectCode: `P-${d.w.org.slice(0, 8)}`, room: "Kitchen", drawingNumber: "KIT-WE-A", revision: "A", checker: "-", approvalStatus: "PRELIMINARY" });
    expect(payload.titleBlock.date).toBe(s.createdAt.slice(0, 10));
    // The engine's BLOCKERs are carried and watermarked (synthetic data is not a production design).
    expect(s.blockerCount).toBeGreaterThan(0);
    expect(payload.watermark).toMatch(/NOT FOR PRODUCTION/);
    const files = s.drawing?.files ?? [];
    expect(files.map((f) => [f.sequence, f.format, f.sheetIndex, f.contentType])).toEqual([
      [1, "PDF", null, "application/pdf"],
      ...payload.sheets.map((_, i) => [i + 2, "SVG", i, "image/svg+xml"]),
    ]);
    // Stored in the database exactly as sealed.
    const links = await sql<{ sequence: number; format: string; checksum: string; storage_key: string }>(
      "SELECT l.sequence, l.format, o.checksum, o.storage_key FROM design_os.drawing_snapshot_file l JOIN design_os.file_object o ON o.id = l.file_object_id WHERE l.snapshot_id = $1 ORDER BY l.sequence", [s.id]);
    expect(links.map((l) => [l.sequence, l.format, l.checksum])).toEqual(files.map((f) => [f.sequence, f.format, f.checksum]));
    // Content-addressed keys: org / project / design version / checksum.
    for (const l of links) expect(l.storage_key).toBe(`org/${d.w.org}/project/${d.projectId}/dv/${v.id}/drawing/${l.checksum.slice(7)}.${l.format === "PDF" ? "pdf" : "svg"}`);
    expect(SnapshotFiles.parse((await read(`drawing-snapshots/${s.id}/files`)).json()).items).toEqual(files);
  });

  it("a room panel schedule of every object", async () => {
    const v = await version(2);
    const s = generated(await draw(v.id, { drawingType: "ROOM_PANEL_SCHEDULE", drawingNumber: "KIT-PS", drawingRevision: "1" })).snapshot;
    expect(s.drawing).toMatchObject({ drawingType: "ROOM_PANEL_SCHEDULE", scope: "ROOM", wallId: null });
    expect((s.payload as { objectIds: string[] }).objectIds.sort()).toEqual(v.lineageIds.sort());
  });
});

describe("cabinet-level drawings", () => {
  it("front elevation, side section (with cut), internal elevation and panel schedule of one object, from the same resolved room", async () => {
    const v = await version(2);
    const obj = v.lineageIds[1] as string;
    for (const [drawingType, extra] of [["FRONT_ELEVATION", {}], ["SIDE_SECTION", { cutXMm: 300 }], ["CABINET_INTERNAL_ELEVATION", {}], ["PANEL_SCHEDULE", {}]] as const) {
      const s = generated(await draw(v.id, { drawingType, objectLineageId: obj, drawingNumber: `KIT-${drawingType.slice(0, 3)}-2`, drawingRevision: "A", ...extra })).snapshot;
      expect([drawingType, s.drawing?.scope, s.drawing?.objectLineageId, s.drawing?.cutXMm]).toEqual([drawingType, "OBJECT", obj, drawingType === "SIDE_SECTION" ? 300 : null]);
      expect((s.payload as { trace: { objectId: string }; type: string }).trace.objectId).toBe(obj);
    }
    // One OUTPUT_GENERATION run for the one context of these inputs (reused by natural identity across requests).
    expect(await sql("SELECT id FROM design_os.validation_run WHERE design_version_id = $1 AND purpose = 'OUTPUT_GENERATION'", [v.id])).toHaveLength(1);
  });

  it("an unknown object is 422 INVALID_REFERENCE and parameters are validated strictly; nothing is recorded", async () => {
    const v = await version();
    const unknown = await draw(v.id, { drawingType: "FRONT_ELEVATION", objectLineageId: "obj_missing", drawingNumber: "X1", drawingRevision: "A" });
    expect([unknown.statusCode, problem(unknown).code]).toEqual([422, "INVALID_REFERENCE"]);
    for (const bad of [
      { drawingType: "FRONT_ELEVATION", drawingNumber: "X1", drawingRevision: "A" },
      { drawingType: "WALL_INTERNAL_ELEVATION", wallId: "E", drawingNumber: "X1", drawingRevision: "A" },
      { drawingType: "ROOM_PANEL_SCHEDULE", drawingNumber: "x1", drawingRevision: "A" },
      { drawingType: "ROOM_PANEL_SCHEDULE", drawingNumber: "X1", drawingRevision: "A", designer: "someone" },
      { drawingType: "FRONT_ELEVATION", objectLineageId: v.lineageIds[0], cutXMm: 10, drawingNumber: "X1", drawingRevision: "A" },
    ]) expect([JSON.stringify(bad), (await draw(v.id, bad)).statusCode]).toEqual([JSON.stringify(bad), 400]);
    expect(await sql("SELECT id FROM design_os.validation_run WHERE design_version_id = $1 AND purpose = 'OUTPUT_GENERATION'", [v.id])).toEqual([]);
  });
});

describe("identity, reuse and the file manifest", () => {
  it("the same drawing request reuses the snapshot and its files; another number, revision or purpose is another snapshot", async () => {
    const v = await version();
    const body = { drawingType: "FRONT_ELEVATION", objectLineageId: v.lineageIds[0], drawingNumber: "KIT-FE-1", drawingRevision: "A" };
    const first = generated(await draw(v.id, body)).snapshot;
    const again = generated(await draw(v.id, body), 200);
    expect([again.reused, again.snapshot.id, again.snapshot.drawing?.files]).toEqual([true, first.id, first.drawing?.files]);
    const revB = generated(await draw(v.id, { ...body, drawingRevision: "B" })).snapshot;
    expect(revB.id).not.toBe(first.id);
    expect(await sql("SELECT id FROM design_os.drawing_snapshot WHERE design_version_id = $1", [v.id])).toHaveLength(2);
  });

  it("files cannot be added to, removed from or swapped in a snapshot after it is sealed (LD016 at commit)", async () => {
    const v = await version();
    const s = generated(await draw(v.id, { drawingType: "ROOM_PANEL_SCHEDULE", drawingNumber: "KIT-PS-M", drawingRevision: "A" })).snapshot;
    const pdf = s.drawing?.files[0];
    const c = await admin();
    try {
      await c.query("BEGIN");
      await c.query("INSERT INTO design_os.drawing_snapshot_file (org_id, snapshot_id, sequence, format, sheet_index, file_object_id) VALUES ($1, $2, 99, 'SVG', 99, $3)", [d.w.org, s.id, pdf?.fileId]);
      await expect(c.query("COMMIT")).rejects.toMatchObject({ code: "LD016" });
    } finally {
      await c.end();
    }
    expect(SnapshotFiles.parse((await read(`drawing-snapshots/${s.id}/files`)).json()).items).toEqual(s.drawing?.files);
  });
});

describe("signed file URLs", () => {
  it("a reader gets a 300-second signed URL; the URL serves exactly the stored bytes (checksum) without a session; tampering or another key is refused", async () => {
    const v = await version();
    const s = generated(await draw(v.id, { drawingType: "PANEL_SCHEDULE", objectLineageId: v.lineageIds[0], drawingNumber: "KIT-PS-1", drawingRevision: "A" })).snapshot;
    for (const f of s.drawing?.files ?? []) {
      const r = await read(`files/${f.fileId}/url?disposition=inline`);
      expect(r.statusCode).toBe(200);
      const u = FileUrlResponse.parse(r.json());
      expect([u.fileId, u.expiresInSeconds, u.checksum, u.contentType]).toEqual([f.fileId, 300, f.checksum, f.contentType]);
      expect(Date.parse(u.expiresAt) - Date.now()).toBeLessThanOrEqual(300_000);
      const got = await download(u.url);
      expect([got.statusCode, got.headers["content-type"], got.headers["content-disposition"]]).toEqual([200, f.contentType, "inline"]);
      const bytes = got.rawPayload;
      expect([bytes.byteLength, `sha256:${(await import("node:crypto")).createHash("sha256").update(bytes).digest("hex")}`]).toEqual([f.byteSize, f.checksum]);
      if (f.format === "PDF") expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      else expect(bytes.toString("utf8")).toMatch(/^<svg|<\?xml/);
    }
    const pdf = s.drawing?.files[0];
    const url = FileUrlResponse.parse((await read(`files/${pdf?.fileId ?? ""}/url`)).json()).url;
    const tampered = await download(url.replace(/sig=([0-9a-f])/, (_, c: string) => `sig=${c === "0" ? "1" : "0"}`));
    expect([tampered.statusCode, problem(tampered).code]).toEqual([403, "SIGNED_URL_INVALID"]);
    const otherKey = await download(url.replace(/\.pdf\?/, ".svg?"));
    expect(otherKey.statusCode).toBe(403);
    // Signed URLs are never persisted.
    expect(await sql("SELECT count(*)::int AS n FROM design_os.file_object WHERE storage_key LIKE '%sig=%'")).toEqual([{ n: 0 }]);
  });
  it("a caller who may not read production outputs, or another organization, gets no URL", async () => {
    const v = await version();
    const s = generated(await draw(v.id, { drawingType: "ROOM_PANEL_SCHEDULE", drawingNumber: "KIT-PS-P", drawingRevision: "A" })).snapshot;
    const fileId = s.drawing?.files[0]?.fileId ?? "";
    expect((await read(`files/${fileId}/url`, "SALES")).statusCode).toBe(404);
    const other = await world();
    expect((await api.request({ method: "GET", url: `/api/v1/files/${fileId}/url`, as: other.users.DESIGN_HEAD })).statusCode).toBe(404);
  });
});

describe("drawing purposes and staleness", () => {
  it("FOR_PRODUCTION needs 0 BLOCKERs of the running build; FOR_REVIEW on an approved design is watermarked and carries the checker", async () => {
    const v = await version();
    await seedApproved(v.id);
    const production = await draw(v.id, { drawingType: "ROOM_PANEL_SCHEDULE", drawingNumber: "KIT-PS-Q", drawingRevision: "A", purpose: "FOR_PRODUCTION" });
    expect([production.statusCode, problem(production).code]).toEqual([409, "VALIDATION_BLOCKERS"]);
    const review = generated(await draw(v.id, { drawingType: "ROOM_PANEL_SCHEDULE", drawingNumber: "KIT-PS-Q", drawingRevision: "A", purpose: "FOR_REVIEW" })).snapshot;
    const tb = (review.payload as { titleBlock: { checker: string; approvalStatus: string; sourceDesignVersionStatus: string } }).titleBlock;
    expect([tb.approvalStatus, tb.sourceDesignVersionStatus, tb.checker === "-"]).toEqual(["FOR_REVIEW", "APPROVED", false]);
    expect(review.qualifiesForIssue).toBe(false);
  });
  it("a cabinet drawing goes stale when its object changes; the detailed endpoint names the object", async () => {
    const v = await version(2);
    const obj = v.lineageIds[0] as string;
    const s = generated(await draw(v.id, { drawingType: "FRONT_ELEVATION", objectLineageId: obj, drawingNumber: "KIT-FE-S", drawingRevision: "A" })).snapshot;
    const [row] = await sql<{ id: string }>("SELECT id FROM design_os.design_object WHERE design_version_id = $1 AND lineage_id = $2", [v.id, obj]);
    const etag = (await read(`design-versions/${v.id}`)).headers.etag as string;
    expect((await api.request({ method: "PATCH", url: `/api/v1/design-objects/${row?.id ?? ""}`, as: as("DESIGNER"), payload: { dimensions: { widthMm: 450, heightMm: 720, depthMm: 560 } }, headers: { "if-match": etag } })).statusCode).toBe(200);
    expect(Snapshot.parse((await read(`drawing-snapshots/${s.id}`)).json()).staleness).toMatchObject({ stale: true, reasons: ["ENGINEERING_INPUTS_CHANGED"] });
    const detailed = DetailedStaleness.parse((await read(`drawing-snapshots/${s.id}/staleness`)).json());
    expect([detailed.model.stale, detailed.model.changedObjectIds]).toEqual([true, [obj]]);
  });
});

describe("outputs graph and validation-run purposes", () => {
  it("lists every readable output with its sources and OUTPUT_GENERATION evidence; kinds the caller cannot read are hidden", async () => {
    const v = await version();
    await api.request({ method: "POST", url: `/api/v1/design-versions/${v.id}/validation-runs`, as: as("DESIGNER"), payload: {}, headers: { "idempotency-key": key() } });
    const boq = generated(await api.request({ method: "POST", url: `/api/v1/design-versions/${v.id}/boq-snapshots`, as: as("DESIGNER"), payload: {}, headers: { "idempotency-key": key() } }));
    const dr = generated(await draw(v.id, { drawingType: "ROOM_PANEL_SCHEDULE", drawingNumber: "KIT-PS-G", drawingRevision: "A" })).snapshot;
    const bomId = boq.snapshot.sources.bomSnapshotId as string;
    const g = OutputsGraph.parse((await read(`design-versions/${v.id}/outputs`)).json());
    expect(g.nodes.map((n) => [n.kind, n.id]).sort()).toEqual([["BOM", bomId], ["BOQ", boq.snapshot.id], ["DRAWING", dr.id]].sort());
    expect(g.nodes.every((n) => !("payload" in n))).toBe(true);
    expect(g.hiddenKinds.sort()).toEqual(["PRICING", "QUOTATION"]);
    expect(g.validationRuns).toHaveLength(1);
    const run = g.validationRuns[0]?.id;
    expect(g.edges).toEqual(expect.arrayContaining([
      { from: bomId, to: boq.snapshot.id, relation: "SOURCE", source: "bomSnapshotId" },
      { from: run, to: bomId, relation: "EVIDENCE" }, { from: run, to: boq.snapshot.id, relation: "EVIDENCE" }, { from: run, to: dr.id, relation: "EVIDENCE" },
    ]));
    expect(OutputsGraph.parse((await read(`design-versions/${v.id}/outputs`, "COSTING")).json()).hiddenKinds).toEqual([]);

    const runs = (purpose?: string) => read(`design-versions/${v.id}/validation-runs${purpose === undefined ? "" : `?purpose=${purpose}`}`).then((r) => r.json<{ items: unknown[] }>().items.map((x) => ValidationRunResponse.parse(x)));
    expect((await runs()).map((r) => r.purpose).sort()).toEqual(["APPROVAL", "OUTPUT_GENERATION"]);
    expect((await runs("APPROVAL")).map((r) => r.purpose)).toEqual(["APPROVAL"]);
    expect((await runs("OUTPUT_GENERATION")).map((r) => r.id)).toEqual([run]);
    expect((await read(`design-versions/${v.id}/validation-runs?purpose=LATEST`)).statusCode).toBe(400);
  });
});
