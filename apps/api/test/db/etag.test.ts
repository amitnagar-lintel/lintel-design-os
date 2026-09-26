/** ETag / If-Match over HTTP against real rows (OD-3): canonical hash ETags, version ETags, lifecycle first. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "../../../../tests/db/support/db.js";
import type { World } from "../../../../tests/db/support/world.js";
import { constructionStandard, transition } from "../../../../tests/db/support/world.js";
import { recordEtag, versionEtag } from "../../src/common/http/etag.js";
import type { Api, Problem } from "../support/harness.js";
import { admin, sql, startApi, world } from "../support/harness.js";
import { ProbeModule } from "../support/probe.module.js";

let api: Api;
let w: World;
let clientId: string;
beforeAll(async () => {
  api = await startApi([ProbeModule]);
  w = await world();
  clientId = (await sql<{ id: string }>("INSERT INTO design_os.client (org_id, client_code, name, contact) VALUES ($1, 'ETAG', 'Mehta', '{\"b\":2,\"a\":1}') RETURNING id::text", [w.org]))[0]?.id ?? "";
});
afterAll(async () => {
  await api.close();
});

const get = () => api.request({ method: "GET", url: `/api/v1/__probe/clients/${clientId}`, as: w.users.SALES });
const rename = (name: string, ifMatch?: string) =>
  api.request({ method: "PATCH", url: `/api/v1/__probe/clients/${clientId}`, as: w.users.SALES, payload: { name }, ...(ifMatch === undefined ? {} : { headers: { "if-match": ifMatch } }) });

describe("hash ETags for mutable non-versioned rows", () => {
  it("the ETag is the canonical hash of the row as the database returns it, stable across reads", async () => {
    const r1 = await get();
    const r2 = await get();
    const row = (await sql<Record<string, unknown>>("SELECT id::text, org_id::text, client_code, name, contact, ops_client_ref, ops_lead_ref, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS created_at FROM design_os.client WHERE id = $1", [clientId]))[0] ?? {};
    expect(r1.headers.etag).toBe(recordEtag("client", row));
    expect(r2.headers.etag).toBe(r1.headers.etag);
    expect(r1.headers.etag).toMatch(/^"sha256:[0-9a-f]{64}"$/);
  });
  it("missing If-Match → 428; stale → 412 STALE_VERSION with the current ETag; current → 200 with a new ETag", async () => {
    const current = (await get()).headers.etag as string;
    const missing = await rename("Mehta 2");
    expect([missing.statusCode, missing.json<Problem>().code]).toEqual([428, "PRECONDITION_REQUIRED"]);
    const ok = await rename("Mehta 2", current);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers.etag).not.toBe(current);
    const stale = await rename("Mehta 3", current);
    expect([stale.statusCode, stale.json<Problem>().code, stale.json<Problem>().context, stale.headers.etag]).toEqual([412, "STALE_VERSION", { currentEtag: ok.headers.etag }, ok.headers.etag]);
  });
  it("two concurrent writers with the same If-Match: exactly one wins, the other gets 412", async () => {
    const current = (await get()).headers.etag as string;
    const results = await Promise.all([rename("Writer A", current), rename("Writer B", current)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 412]);
  });
});

describe("version ETags and lifecycle-before-ETag", () => {
  it("a DRAFT version accepts its current \"<id>:<row_version>\"; after SUBMIT the same (correct) ETag is refused RECORD_NOT_EDITABLE", async () => {
    const c = await admin();
    let id: string;
    try {
      await c.query("BEGIN");
      id = await constructionStandard(c as unknown as Tx, w, { code: `CS_ETAG_${w.org.slice(0, 4)}` });
      await c.query("COMMIT");
    } finally {
      await c.end();
    }
    const patch = (reason: string, ifMatch: string) => api.request({ method: "PATCH", url: `/api/v1/__probe/construction-standards/${id}`, as: w.users.PRODUCTION, payload: { changeReason: reason }, headers: { "if-match": ifMatch } });
    const v1 = versionEtag(id, 1);
    const ok = await patch("first edit", v1);
    expect([ok.statusCode, ok.headers.etag]).toEqual([200, versionEtag(id, 2)]);
    const stale = await patch("second edit", v1);
    expect([stale.statusCode, stale.json<Problem>().code]).toEqual([412, "STALE_VERSION"]);
    const c2 = await admin();
    try {
      await c2.query("BEGIN");
      await transition(c2 as unknown as Tx, w, "PRODUCTION", "construction_standard", id, "SUBMIT");
      await c2.query("COMMIT");
    } finally {
      await c2.end();
    }
    const rv = (await sql<{ rv: number }>("SELECT row_version AS rv FROM design_os.construction_standard_version WHERE id = $1", [id]))[0]?.rv ?? 0;
    const locked = await patch("edit in review", versionEtag(id, rv));
    expect([locked.statusCode, locked.json<Problem>().code, locked.json<Problem>().context]).toEqual([409, "RECORD_NOT_EDITABLE", { status: "IN_REVIEW" }]);
  });
});
