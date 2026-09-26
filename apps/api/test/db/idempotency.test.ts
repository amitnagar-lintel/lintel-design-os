/** Idempotency over HTTP (OD-2): claim → execute once → replay; conflicts; in-progress; never twice. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { World } from "../../../../tests/db/support/world.js";
import type { Api, Problem } from "../support/harness.js";
import { sql, startApi, world } from "../support/harness.js";
import { ProbeModule } from "../support/probe.module.js";

let api: Api;
let w: World;
beforeAll(async () => {
  api = await startApi([ProbeModule]);
  w = await world();
});
afterAll(async () => {
  await api.close();
});

const invite = (key: string | undefined, payload: Record<string, unknown>, as = w.users.SALES) =>
  api.request({ method: "POST", url: "/api/v1/__probe/invites", as, payload, ...(key === undefined ? {} : { headers: { "idempotency-key": key } }) });
const effects = async (name: string) => Number((await sql<{ n: string }>("SELECT count(*) AS n FROM design_os.client WHERE org_id = $1 AND name = $2", [w.org, name]))[0]?.n);

describe("claim / replay / conflict", () => {
  it("first request executes (201 + Location); an identical retry replays the original result without executing", async () => {
    const key = randomUUID();
    const first = await invite(key, { name: "replay-1" });
    expect(first.statusCode).toBe(201);
    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    const again = await invite(key, { name: "replay-1" });
    expect([again.statusCode, again.json(), again.headers.location, again.headers["idempotent-replayed"]]).toEqual([201, first.json(), first.headers.location, "true"]);
    expect(await effects("replay-1")).toBe(1);
  });
  it("same key, different request → 409 IDEMPOTENCY_CONFLICT; another user with the same key → 409 as well", async () => {
    const key = randomUUID();
    expect((await invite(key, { name: "conflict-1" })).statusCode).toBe(201);
    const other = await invite(key, { name: "conflict-2" });
    expect([other.statusCode, other.json<Problem>().code]).toEqual([409, "IDEMPOTENCY_CONFLICT"]);
    const otherUser = await invite(key, { name: "conflict-1" }, w.users.DESIGN_HEAD);
    expect([otherUser.statusCode, otherUser.json<Problem>().code]).toEqual([409, "IDEMPOTENCY_CONFLICT"]);
    expect(await effects("conflict-2")).toBe(0);
  });
  it("missing key → 428 PRECONDITION_REQUIRED; malformed key → 400", async () => {
    const missing = await invite(undefined, { name: "nokey" });
    expect([missing.statusCode, missing.json<Problem>().code]).toEqual([428, "PRECONDITION_REQUIRED"]);
    expect((await invite("short", { name: "nokey" })).statusCode).toBe(400);
    expect(await effects("nokey")).toBe(0);
  });
  it("a failed operation stores nothing: the same key can be retried", async () => {
    const key = randomUUID();
    const denied = await invite(key, { name: "retry-after-failure" }, w.users.DESIGNER);
    expect(denied.statusCode).toBe(403);
    expect((await invite(key, { name: "retry-after-failure" })).statusCode).toBe(201);
  });
});

describe("concurrent duplicates never execute twice", () => {
  it("two simultaneous identical requests: one executes, the other replays (or is told it is in progress)", async () => {
    const key = randomUUID();
    const rs = await Promise.all([invite(key, { name: "race-1" }), invite(key, { name: "race-1" })]);
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 201]);
    expect(rs.filter((r) => r.headers["idempotent-replayed"] === "true")).toHaveLength(1);
    expect(await effects("race-1")).toBe(1);
  });
  it("a duplicate of a still-running request gets 409 IDEMPOTENCY_IN_PROGRESS; the original completes once", async () => {
    const key = randomUUID();
    const slow = invite(key, { name: "in-progress-1", holdMs: 7000 });
    await new Promise((r) => setTimeout(r, 500));
    const dup = await invite(key, { name: "in-progress-1", holdMs: 7000 });
    expect([dup.statusCode, dup.json<Problem>().code]).toEqual([409, "IDEMPOTENCY_IN_PROGRESS"]);
    expect((await slow).statusCode).toBe(201);
    expect((await invite(key, { name: "in-progress-1", holdMs: 7000 })).headers["idempotent-replayed"]).toBe("true");
    expect(await effects("in-progress-1")).toBe(1);
  }, 30_000);
});
