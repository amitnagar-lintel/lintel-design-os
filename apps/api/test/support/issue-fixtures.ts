/**
 * Issue test fixtures over a committed domain world: fresh designs, lifecycle transitions through the database's own
 * path (seeded 0-BLOCKER APPROVAL evidence of a test engine), and FOR_PRODUCTION snapshots seeded through the
 * provenance gate with the tests/db builders (the real engines cannot give 0 BLOCKERs on the synthetic test data).
 * A seeded drawing reuses the REAL stored files of a drawing the API generated, so its sealed manifest is genuine.
 */
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { Tx } from "../../../../tests/db/support/db.js";
import { insertRow } from "../../../../tests/db/support/db.js";
import { approve as approveVersion, hashOf, outputChainRow, pricingStandard, transition, validationRun } from "../../../../tests/db/support/world.js";
import { VersionResponse } from "../../src/modules/design-versions/design-versions.schemas.js";
import { GenerateResponse } from "../../src/modules/outputs/outputs.schemas.js";
import type { DomainWorld } from "./domain.js";
import { cabinet, key } from "./domain.js";
import type { Api } from "./harness.js";
import { admin, sql } from "./harness.js";

export type Role = keyof DomainWorld["w"]["users"];
export type Stage = "DRAFT" | "IN_REVIEW" | "APPROVED" | "LOCKED";
export type Seeded = { readonly id: string; readonly contentHash: string };
type AdminTx = Tx & { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** One committed admin transaction on the race database. */
export async function seeded<T>(fn: (c: AdminTx) => Promise<T>): Promise<T> {
  const c = await admin();
  try {
    await c.query("BEGIN");
    const r = await fn(c as never);
    await c.query("COMMIT");
    return r;
  } finally {
    await c.end();
  }
}

/** Rows a given identity can read directly under RLS (the API role with that user's verified claims). */
export function readAs(userId: string, orgId: string) {
  return (query: string, params: unknown[]) => seeded(async (c) => {
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, org_id: orgId })]);
    await c.query("SET LOCAL ROLE design_os_api");
    return (await c.query(query, params)).rows as Record<string, string>[];
  });
}

export function issueFixtures(api: Api, d: DomainWorld, where: { readonly roomId: string } = { roomId: d.roomId }) {
  const as = (role: Role) => d.w.users[role];
  const productVersionId = (d.deps.items.product as { versionId: string }).versionId;
  const pricingId = () => d.deps.commercial.pricing_standard_version_id as string;
  const policyId = () => d.deps.commercial.quotation_policy_version_id as string;

  /** A new design (so approvals / supersession never touch another scenario) with one DRAFT version and one cabinet. */
  async function draftVersion(): Promise<{ designId: string; versionId: string }> {
    const design = await api.request({ method: "POST", url: `/api/v1/rooms/${where.roomId}/designs`, as: as("DESIGNER"), headers: { "idempotency-key": key() }, payload: { name: `Issue ${randomUUID().slice(0, 6)}` } });
    expect(design.statusCode).toBe(201);
    const designId = design.json<{ id: string }>().id;
    const v = VersionResponse.parse((await api.request({ method: "POST", url: `/api/v1/designs/${designId}/versions`, as: as("DESIGNER"), headers: { "idempotency-key": key() }, payload: { pins: d.pins, changeReason: "issue" } })).json());
    const etag = (await api.request({ method: "GET", url: `/api/v1/design-versions/${v.id}`, as: as("DESIGNER") })).headers.etag as string;
    expect((await api.request({ method: "POST", url: `/api/v1/design-versions/${v.id}/objects`, as: as("DESIGNER"), payload: cabinet(productVersionId), headers: { "if-match": etag } })).statusCode).toBe(201);
    return { designId, versionId: v.id };
  }

  async function advance(versionId: string, to: Stage): Promise<void> {
    if (to === "DRAFT") return;
    await seeded(async (c) => {
      const [v] = await sql<{ input_hash: string }>("SELECT input_hash FROM design_os.design_version WHERE id = $1", [versionId]);
      await validationRun(c, d.w, versionId, v?.input_hash as string, 0);
      await transition(c, d.w, "DESIGNER", "design", versionId, "SUBMIT");
      if (to === "IN_REVIEW") return;
      await transition(c, d.w, "DESIGN_HEAD", "design", versionId, "APPROVE", "approved", await hashOf(c, "design", versionId));
      if (to === "LOCKED") await transition(c, d.w, "SALES", "design", versionId, "LOCK", "locked for issue");
    });
  }

  async function seedQuotation(versionId: string, purpose: "PRELIMINARY" | "FOR_REVIEW" | "FOR_PRODUCTION", revisionNumber = 1, blockers = 0): Promise<Seeded> {
    return seeded(async (c) => {
      const row = await outputChainRow(c, d.w, versionId, "QUOTATION", d.deps.commercial, { purpose, engineSeed: randomUUID(), revisionNumber, blockers });
      await insertRow(c, "quotation_snapshot", row);
      return { id: row.id as string, contentHash: row.content_hash as string };
    });
  }

  /** A real (PRELIMINARY) drawing generated by the API: its stored files are reused by seeded drawings. */
  async function generatedDrawing(versionId: string, number: string): Promise<{ id: string; manifest: string; files: { fileId: string }[] }> {
    const r = await api.request({ method: "POST", url: `/api/v1/design-versions/${versionId}/drawing-snapshots`, as: as("DESIGNER"), headers: { "idempotency-key": key() },
      payload: { drawingType: "ROOM_PANEL_SCHEDULE", drawingNumber: number, drawingRevision: "P" } });
    const s = GenerateResponse.parse(r.json()).snapshot;
    return { id: s.id, manifest: s.drawing?.fileManifestHash ?? "", files: s.drawing?.files ?? [] };
  }

  async function seedDrawing(versionId: string, purpose: "PRELIMINARY" | "FOR_REVIEW" | "FOR_PRODUCTION", source: { id: string; manifest: string }, number: string, revision = "A"): Promise<Seeded> {
    return seeded(async (c) => {
      const row = await outputChainRow(c, d.w, versionId, "DRAWING", null, {
        purpose, engineSeed: randomUUID(),
        drawing: { drawingType: "ROOM_PANEL_SCHEDULE", wallId: null, objectLineageId: null, cutXMm: null, drawingNumber: number, drawingRevision: revision, fileManifestHash: source.manifest as `sha256:${string}` },
      });
      await insertRow(c, "drawing_snapshot", row);
      await c.query(`INSERT INTO design_os.drawing_snapshot_file (org_id, snapshot_id, sequence, format, sheet_index, file_object_id)
        SELECT org_id, $2, sequence, format, sheet_index, file_object_id FROM design_os.drawing_snapshot_file WHERE snapshot_id = $1`, [source.id, row.id]);
      return { id: row.id as string, contentHash: row.content_hash as string };
    });
  }

  /** A new version of the world's PricingStandard (synthetic, test-only values), optionally APPROVED. */
  async function newPricingVersion(approve: boolean): Promise<string> {
    return seeded(async (c) => {
      const [e] = (await c.query("SELECT entity_id FROM design_os.pricing_standard_version WHERE id = $1", [pricingId()])).rows as { entity_id: string }[];
      const [m] = (await c.query("SELECT max(version_number) + 1 AS n FROM design_os.pricing_standard_version WHERE entity_id = $1", [e?.entity_id])).rows as { n: number }[];
      const id = await pricingStandard(c, d.w, { complete: true, entityId: e?.entity_id as string, versionNumber: Number(m?.n) });
      if (approve) await approveVersion(c, d.w, "pricing_standard", id);
      return id;
    });
  }

  const issueQuotation = (id: string, body: Record<string, unknown>, role: Role = "SALES", k = key()) =>
    api.request({ method: "POST", url: `/api/v1/quotation-snapshots/${id}/issue`, as: as(role), payload: body, headers: { "idempotency-key": k } });
  const issueDrawing = (id: string, body: Record<string, unknown>, role: Role = "DESIGN_HEAD", k = key()) =>
    api.request({ method: "POST", url: `/api/v1/drawing-snapshots/${id}/issue`, as: as(role), payload: body, headers: { "idempotency-key": k } });
  const quotationBody = (q: { contentHash: string }, over: Record<string, unknown> = {}) =>
    ({ reason: "Sent to client", expectedContentHash: q.contentHash, pricingStandardVersionId: pricingId(), quotationPolicyVersionId: policyId(), ...over });
  const status = async (versionId: string) => (await sql<{ status: string }>("SELECT status FROM design_os.design_version WHERE id = $1", [versionId]))[0]?.status;

  return { as, pricingId, policyId, draftVersion, advance, seedQuotation, generatedDrawing, seedDrawing, newPricingVersion, issueQuotation, issueDrawing, quotationBody, status };
}
