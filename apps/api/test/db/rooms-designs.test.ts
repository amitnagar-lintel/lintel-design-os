/** Rooms, immutable survey revisions and designs over HTTP (M5 Step 5). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DesignResponse } from "../../src/modules/designs/designs.schemas.js";
import { RevisionResponse, RoomResponse } from "../../src/modules/rooms/rooms.schemas.js";
import type { DomainWorld } from "../support/domain.js";
import { domainWorld, key, SURVEY } from "../support/domain.js";
import type { Api, Problem } from "../support/harness.js";
import { sql, startApi, world } from "../support/harness.js";

let api: Api;
let d: DomainWorld;
beforeAll(async () => {
  api = await startApi();
  d = await domainWorld(api, { withDeps: false });
});
afterAll(async () => {
  await api.close();
});

const problem = (r: { json: () => unknown }) => r.json() as Problem;

describe("rooms", () => {
  it("creation requires an Idempotency-Key; a retry replays the original room instead of creating another", async () => {
    const url = `/api/v1/projects/${d.projectId}/rooms`;
    const payload = { name: "Utility", roomType: "KITCHEN" };
    expect(problem(await api.request({ method: "POST", url, as: d.w.users.SITE_ENGINEER, payload })).code).toBe("PRECONDITION_REQUIRED");
    const k = key();
    const first = await api.request({ method: "POST", url, as: d.w.users.SITE_ENGINEER, payload, headers: { "idempotency-key": k } });
    const again = await api.request({ method: "POST", url, as: d.w.users.SITE_ENGINEER, payload, headers: { "idempotency-key": k } });
    expect([first.statusCode, again.statusCode, again.headers["idempotent-replayed"]]).toEqual([201, 201, "true"]);
    expect(RoomResponse.parse(again.json()).id).toBe(RoomResponse.parse(first.json()).id);
    expect((await sql("SELECT 1 FROM design_os.room WHERE project_id = $1 AND name = 'Utility'", [d.projectId]))).toHaveLength(1);
  });
  it("a room shows its latest survey; only survey dimensions are accepted (derived geometry is rejected)", async () => {
    const r = await api.request({ method: "GET", url: `/api/v1/rooms/${d.roomId}`, as: d.w.users.DESIGNER });
    const room = RoomResponse.parse(r.json());
    expect(room.latestRevision).toMatchObject({ revisionNumber: 1, lengthMm: 4200, widthMm: 3200, heightMm: 3000, wallThicknessMm: 150, surveyedBy: d.w.users.SITE_ENGINEER });
    const derived = await api.request({ method: "POST", url: `/api/v1/rooms/${d.roomId}/revisions`, as: d.w.users.SITE_ENGINEER, headers: { "idempotency-key": key() }, payload: { ...SURVEY, areaM2: 13.44, walls: [] } });
    expect([derived.statusCode, problem(derived).code]).toEqual([400, "VALIDATION_FAILED"]);
    expect((await api.request({ method: "POST", url: `/api/v1/rooms/${d.roomId}/revisions`, as: d.w.users.SITE_ENGINEER, headers: { "idempotency-key": key() }, payload: { ...SURVEY, lengthMm: 4200.123 } })).statusCode).toBe(400);
  });
  it("revisions are numbered sequentially, immutable, and listed newest first", async () => {
    const add = (lengthMm: number) => api.request({ method: "POST", url: `/api/v1/rooms/${d.roomId}/revisions`, as: d.w.users.SITE_ENGINEER, headers: { "idempotency-key": key() }, payload: { ...SURVEY, lengthMm } });
    const r2 = RevisionResponse.parse((await add(4210)).json());
    const r3 = RevisionResponse.parse((await add(4220.5)).json());
    expect([r2.revisionNumber, r3.revisionNumber, r3.lengthMm]).toEqual([2, 3, 4220.5]);
    expect(r3.contentHash).toMatch(/^sha256:/);
    const list = await api.request({ method: "GET", url: `/api/v1/rooms/${d.roomId}/revisions?limit=2`, as: d.w.users.DESIGNER });
    const page = list.json<{ items: { revisionNumber: number }[]; nextCursor: string }>();
    expect(page.items.map((x) => x.revisionNumber)).toEqual([3, 2]);
    const rest = await api.request({ method: "GET", url: `/api/v1/rooms/${d.roomId}/revisions?limit=2&cursor=${page.nextCursor}`, as: d.w.users.DESIGNER });
    expect(rest.json<{ items: { revisionNumber: number }[]; nextCursor: string | null }>()).toMatchObject({ items: [{ revisionNumber: 1 }], nextCursor: null });
    // No update / delete route exists; the database refuses both anyway.
    expect((await api.request({ method: "PATCH", url: `/api/v1/room-revisions/${r2.id}`, as: d.w.users.SITE_ENGINEER, payload: { lengthMm: 1 } })).statusCode).toBe(404);
    await expect(sql("UPDATE design_os.room_revision SET length_mm = 1 WHERE id = $1", [r2.id])).rejects.toMatchObject({ code: "LD015" });
  });
  it("rename needs If-Match; roles without room.survey.write cannot; other tenants see nothing", async () => {
    const etag = (await api.request({ method: "GET", url: `/api/v1/rooms/${d.roomId}`, as: d.w.users.SITE_ENGINEER })).headers.etag as string;
    expect((await api.request({ method: "PATCH", url: `/api/v1/rooms/${d.roomId}`, as: d.w.users.SALES, payload: { name: "x" }, headers: { "if-match": etag } })).statusCode).toBe(403);
    const ok = await api.request({ method: "PATCH", url: `/api/v1/rooms/${d.roomId}`, as: d.w.users.SITE_ENGINEER, payload: { name: "Main kitchen" }, headers: { "if-match": etag } });
    expect([ok.statusCode, RoomResponse.parse(ok.json()).name]).toEqual([200, "Main kitchen"]);
    const other = await world();
    expect((await api.request({ method: "GET", url: `/api/v1/rooms/${d.roomId}`, as: other.users.DESIGN_HEAD })).statusCode).toBe(404);
  });
});

describe("designs", () => {
  it("a design is associated with its room's project; listed by room and by project; renamed / archived with If-Match", async () => {
    const r = await api.request({ method: "GET", url: `/api/v1/designs/${d.designId}`, as: d.w.users.DESIGNER });
    expect(DesignResponse.parse(r.json())).toMatchObject({ projectId: d.projectId, roomId: d.roomId, status: "ACTIVE" });
    for (const url of [`/api/v1/rooms/${d.roomId}/designs`, `/api/v1/projects/${d.projectId}/designs`]) {
      expect((await api.request({ method: "GET", url, as: d.w.users.DESIGNER })).json<{ items: { id: string }[] }>().items.map((x) => x.id)).toContain(d.designId);
    }
    const upd = await api.request({ method: "PATCH", url: `/api/v1/designs/${d.designId}`, as: d.w.users.DESIGNER, payload: { status: "ARCHIVED" }, headers: { "if-match": r.headers.etag as string } });
    expect([upd.statusCode, DesignResponse.parse(upd.json()).status]).toEqual([200, "ARCHIVED"]);
    expect((await api.request({ method: "PATCH", url: `/api/v1/designs/${d.designId}`, as: d.w.users.DESIGNER, payload: { roomId: d.roomId }, headers: { "if-match": upd.headers.etag as string } })).statusCode).toBe(400);
  });
  it("only design authors create designs; a project the caller cannot access reads as missing", async () => {
    expect(problem(await api.request({ method: "POST", url: `/api/v1/rooms/${d.roomId}/designs`, as: d.w.users.SALES, headers: { "idempotency-key": key() }, payload: { name: "x" } })).code).toBe("PERMISSION_DENIED");
    const other = await world();
    const r = await api.request({ method: "POST", url: `/api/v1/rooms/${d.roomId}/designs`, as: other.users.DESIGNER, headers: { "idempotency-key": key() }, payload: { name: "x" } });
    expect([r.statusCode, problem(r).code]).toEqual([404, "NOT_FOUND"]);
  });
});
