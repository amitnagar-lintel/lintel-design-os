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
    expect(report.pdfs.length).toBe(2);
  });
});
