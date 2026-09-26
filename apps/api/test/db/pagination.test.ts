/** Cursor pagination over HTTP (OD-6): stable (created_at, id) order, max 200, cursors bound to org and collection. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { World } from "../../../../tests/db/support/world.js";
import type { Api, Problem } from "../support/harness.js";
import { sql, startApi, world } from "../support/harness.js";
import { ProbeModule } from "../support/probe.module.js";

let api: Api;
let w: World;
let expected: string[];
beforeAll(async () => {
  api = await startApi([ProbeModule]);
  w = await world();
  // 7 clients; 4 share one created_at, so only the id tiebreaker keeps the order deterministic.
  for (let i = 0; i < 7; i++) {
    await sql("INSERT INTO design_os.client (id, org_id, client_code, name, created_at) VALUES ($1, $2, $3, $4, $5)",
      [randomUUID(), w.org, `PG_${String(i)}`, `page-${String(i)}`, i < 4 ? "2026-09-26T10:00:00.123456Z" : `2026-09-26T11:00:0${String(i)}.5Z`]);
  }
  expected = (await sql<{ id: string }>("SELECT id::text FROM design_os.client WHERE org_id = $1 ORDER BY created_at DESC, id DESC", [w.org])).map((r) => r.id);
});
afterAll(async () => {
  await api.close();
});

const page = (query: string, as = w.users.SALES, org?: string) =>
  api.request({ method: "GET", url: `/api/v1/__probe/clients${query}`, as, ...(org === undefined ? {} : { org }) });

describe("keyset pages", () => {
  it("walks every row exactly once in (created_at DESC, id DESC) order, including ties", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r = await page(`?limit=3${cursor === null ? "" : `&cursor=${cursor}`}`);
      expect(r.statusCode).toBe(200);
      const body = r.json<{ items: { id: string }[]; nextCursor: string | null }>();
      seen.push(...body.items.map((x) => x.id));
      cursor = body.nextCursor;
      pages++;
    } while (cursor !== null && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual(expected);
  });
  it("limit is 1..200 and offset pagination does not exist", async () => {
    expect((await page("?limit=200")).statusCode).toBe(200);
    expect((await page("?limit=201")).json<Problem>().code).toBe("VALIDATION_FAILED");
    expect((await page("?limit=0")).statusCode).toBe(400);
    expect((await page("?offset=3")).statusCode).toBe(400);
  });
  it("tampered cursors and cursors issued in another organization are INVALID_CURSOR", async () => {
    const first = (await page("?limit=2")).json<{ nextCursor: string }>().nextCursor;
    const [body, sig] = first.split(".") as [string, string];
    expect((await page(`?limit=2&cursor=${body}.${sig.slice(0, -2)}AA`)).json<Problem>().code).toBe("INVALID_CURSOR");
    const b = await world();
    await sql("INSERT INTO design_os.org_membership (org_id, user_id, role) VALUES ($1, $2, 'SALES')", [b.org, w.users.SALES]);
    const foreign = await page(`?limit=2&cursor=${first}`, w.users.SALES, b.org);
    expect([foreign.statusCode, foreign.json<Problem>().code]).toEqual([400, "INVALID_CURSOR"]);
  });
});
