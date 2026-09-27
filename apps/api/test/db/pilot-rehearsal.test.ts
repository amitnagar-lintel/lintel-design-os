/**
 * The technical pilot rehearsal (M6 STEP 6) against PostgreSQL, through the real API, engines, intake CLI and approval
 * workflow: onboarding → rehearsal dataset (LOCAL REHEARSAL ONLY, synthetic) → Project → rectangular kitchen → base run
 * → DesignVersion → validation → approval → BOM → BOQ → Pricing → Quotation → Drawings → Issue → PDF. Every output
 * must derive from the same DesignVersion, inputs and exact pins.
 */
import { decodeJwt } from "jose";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import pg from "pg";
import { loadMigrations } from "@lintel/db-tools/migrations";
import { loadRehearsalData, onboardRehearsal, PILOT_REQUIRED_TYPES, runPilotWorkflow } from "@lintel/db-tools/pilot";
import { PILOT_REQUIRED_TYPES as API_REQUIRED } from "../../src/modules/readiness/readiness.service.js";
import type { Http } from "@lintel/db-tools/pilot";
import type { Api } from "../support/harness.js";
import { ISSUER, startApi, token } from "../support/harness.js";

let api: Api;
beforeAll(async () => { api = await startApi(); });
afterAll(async () => { await api.close(); });

const http: Http = async (method, path, o = {}) => {
  const r = await api.app.getHttpAdapter().getInstance().inject({
    method, url: path.replace(/^https?:\/\/[^/]+/, ""), headers: { ...o.headers, ...(o.token === undefined ? {} : { authorization: `Bearer ${o.token}` }) },
    ...(o.body === undefined ? {} : { payload: o.body as object }),
  });
  const type = r.headers["content-type"] ?? "";
  return { status: r.statusCode, headers: Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k, v === undefined ? undefined : String(v)])), body: /json/.test(type) && r.body !== "" ? r.json<unknown>() : null, bytes: new Uint8Array(r.rawPayload) };
};

describe("pilot rehearsal (LOCAL, synthetic rehearsal data)", () => {
  it("pilot:check requires exactly the data the API's readiness gate requires", () => {
    expect([...PILOT_REQUIRED_TYPES].sort()).toEqual([...API_REQUIRED].sort());
  });

  it("runs the whole pilot workflow with the real engines and 0 BLOCKERs; every output derives from one DesignVersion", async () => {
    const client = new pg.Client({ connectionString: inject("raceDbUrl") });
    await client.connect();
    let tokens;
    try {
      tokens = await onboardRehearsal(client, loadMigrations(), http, (userId, email) => token(userId, { email, email_verified: true }));
    } finally {
      await client.end();
    }
    const lines: string[] = [];
    await loadRehearsalData({
      env: { MIGRATION_DATABASE_URL: inject("raceDbUrl"), AUTH_ISSUER: ISSUER }, tokens, dir: `${process.env.TMPDIR ?? "/tmp"}/lintel-rehearsal-test`,
      verifier: (t) => Promise.resolve({ userId: decodeJwt(t).sub ?? "" }), log: (l) => lines.push(l),
    });
    const report = await runPilotWorkflow(http, tokens, undefined, (l) => lines.push(l));
    expect(report.designStatus).toBe("LOCKED");
    expect(report.validation.blockers).toBe(0);
    expect(Object.values(report.consistency).every(Boolean)).toBe(true);
    expect(report.pdfs.length).toBe(3);

    // The quotation document is sealed into the snapshot like a drawing's files: immutable, and nothing can be added.
    const quotationId = report.issued.quotation;
    const admin = new pg.Client({ connectionString: inject("raceDbUrl") });
    await admin.connect();
    try {
      const [q] = (await admin.query<{ file_manifest_hash: string | null }>("SELECT file_manifest_hash FROM design_os.quotation_snapshot WHERE id = $1", [quotationId])).rows;
      expect(q?.file_manifest_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      const [link] = (await admin.query<{ org_id: string; file_object_id: string }>("SELECT org_id, file_object_id FROM design_os.quotation_snapshot_file WHERE snapshot_id = $1", [quotationId])).rows;
      await expect(admin.query("UPDATE design_os.quotation_snapshot_file SET sequence = 2 WHERE snapshot_id = $1", [quotationId])).rejects.toThrow();
      await expect(admin.query("DELETE FROM design_os.quotation_snapshot_file WHERE snapshot_id = $1", [quotationId])).rejects.toThrow();
      await admin.query("BEGIN");
      await admin.query("INSERT INTO design_os.quotation_snapshot_file (org_id, snapshot_id, sequence, format, file_object_id) VALUES ($1, $2, 2, 'SVG', $3)", [link!.org_id, quotationId, link!.file_object_id])
        .then(() => admin.query("COMMIT")).then(() => { throw new Error("an extra link was accepted"); }, async (e: unknown) => { await admin.query("ROLLBACK"); expect(String(e)).toMatch(/not valid for quotations|manifest/); });
    } finally {
      await admin.end();
    }
    // Cost readers only: a designer (production reader) cannot list the quotation's document.
    expect((await http("GET", `/api/v1/quotation-snapshots/${quotationId}/files`, { token: tokens.DESIGNER })).status).toBe(403);
  });
});
