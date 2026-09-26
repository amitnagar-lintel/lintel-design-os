/**
 * Rate limiting (M6 CP3) through the real API: per client IP before authentication, and per user and organization by
 * route class (read / write / sensitive). Exceeding a limit is 429 RATE_LIMITED with Retry-After; other users,
 * organizations and classes keep their own counters.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { World } from "../../../../tests/db/support/world.js";
import type { Api, Problem } from "../support/harness.js";
import { startApi, token, world } from "../support/harness.js";

let api: Api;
let w: World;
let other: World;
const problem = (r: { json: () => unknown }) => r.json() as Problem;

beforeAll(async () => {
  api = await startApi([], { rateLimit: { enabled: true, windowMs: 60_000, ip: 40, read: 3, write: 2, sensitive: 1 } });
  w = await world();
  other = await world();
});
afterAll(async () => {
  await api.close();
});

describe("per user and organization, by route class", () => {
  it("allows up to the read limit, then refuses with a stable RFC 9457 problem and Retry-After", async () => {
    for (let i = 0; i < 3; i++) expect((await api.request({ method: "GET", url: "/api/v1/me", as: w.users.DESIGNER, remoteAddress: "10.0.0.1" })).statusCode).toBe(200);
    const r = await api.request({ method: "GET", url: "/api/v1/me", as: w.users.DESIGNER, remoteAddress: "10.0.0.1" });
    expect(r.statusCode).toBe(429);
    expect(r.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(problem(r)).toMatchObject({ code: "RATE_LIMITED", status: 429, title: expect.any(String) as string });
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
    // Another user, and the same person's class of another kind, have their own counters.
    expect((await api.request({ method: "GET", url: "/api/v1/me", as: w.users.DESIGN_HEAD, remoteAddress: "10.0.0.1" })).statusCode).toBe(200);
    expect((await api.request({ method: "GET", url: "/api/v1/me", as: other.users.DESIGNER, remoteAddress: "10.0.0.1" })).statusCode).toBe(200);
  });

  it("sensitive routes (onboarding, invitations, role changes, transitions, issue) have the lowest limit", async () => {
    const invite = () => api.request({ method: "POST", url: "/api/v1/org/invitations", as: w.users.ADMIN, remoteAddress: "10.0.0.2", payload: { email: `p.${randomUUID().slice(0, 8)}@lintel.example`, displayName: "Rate Test", roles: ["DESIGNER"] } });
    expect((await invite()).statusCode).toBe(201);
    expect(problem(await invite()).code).toBe("RATE_LIMITED");
    // The first-sign-in routes (no organization yet) are keyed by the verified user.
    const person = randomUUID();
    const bearer = await token(person, { email: "rate.person@lintel.example", email_verified: true });
    const mine = () => api.request({ method: "GET", url: "/api/v1/me/invitations", headers: { authorization: `Bearer ${bearer}` }, remoteAddress: "10.0.0.2" });
    expect((await mine()).statusCode).toBe(200);
    expect(problem(await mine()).code).toBe("RATE_LIMITED");
  });

  it("writes have their own limit", async () => {
    const create = () => api.request({ method: "POST", url: "/api/v1/clients", as: w.users.SALES, remoteAddress: "10.0.0.3", payload: { clientCode: `RL-${randomUUID().slice(0, 8)}`, name: "Rate client" } });
    expect((await create()).statusCode).toBe(201);
    expect((await create()).statusCode).toBe(201);
    expect(problem(await create()).code).toBe("RATE_LIMITED");
  });
});

describe("per client IP, before authentication", () => {
  it("limits every request of an address — including unauthenticated ones and public routes — and only that address", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 40; i++) lastStatus = (await api.request({ method: "GET", url: "/api/v1/health", remoteAddress: "10.9.9.9" })).statusCode;
    expect(lastStatus).toBe(200);
    const r = await api.request({ method: "GET", url: "/api/v1/me", headers: { authorization: "Bearer not-a-token" }, remoteAddress: "10.9.9.9" });
    expect([r.statusCode, problem(r).code]).toEqual([429, "RATE_LIMITED"]);
    expect((await api.request({ method: "GET", url: "/api/v1/health", remoteAddress: "10.9.9.10" })).statusCode).toBe(200);
  });
});
