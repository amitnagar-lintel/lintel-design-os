/**
 * Reference-data read API (M6 G1) against PostgreSQL: read-only, tenant-safe, exact lifecycle, PRODUCTION rows
 * only, provenance, version selection, pagination (incl. Hettich), and the permission for internal cost content.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approve, constructionStandard, hashOf, hettichDataset, pricingStandard, transition } from "../../../../tests/db/support/world.js";
import { ReferenceEntity, ReferenceTypeList, ReferenceVersion, ReferenceVersionDetail, REFERENCE_TYPES } from "../../src/modules/reference-data/reference-data.schemas.js";
import type { Api, Problem } from "../support/harness.js";
import { sql, startApi, world } from "../support/harness.js";
import { seeded } from "../support/issue-fixtures.js";
import type { World } from "../../../../tests/db/support/world.js";
import { z } from "zod";

let api: Api;
let w: World;
let other: World;
const problem = (r: { json: () => unknown }) => r.json() as Problem;
const get = (url: string, as: string) => api.request({ method: "GET", url: `/api/v1/reference-data${url}`, as });
const page = <T extends z.ZodType>(item: T) => z.strictObject({ items: z.array(item), nextCursor: z.string().nullable() });

let v1: string; // construction standard v1 (APPROVED → SUPERSEDED)
let v2: string; // construction standard v2 (APPROVED)
let v3: string; // construction standard v3 (DRAFT, production draft values: NULL / UNVERIFIED)
let hettich: string;
let pricing: string;

beforeAll(async () => {
  api = await startApi();
  w = await world();
  other = await world();
  await seeded(async (c) => {
    v1 = await constructionStandard(c, w, { complete: true });
    await approve(c, w, "construction_standard", v1);
    const entityId = (await c.query<{ entity_id: string }>("SELECT entity_id FROM design_os.construction_standard_version WHERE id = $1", [v1])).rows[0]!.entity_id;
    v2 = await constructionStandard(c, w, { complete: true, entityId, versionNumber: 2 });
    await approve(c, w, "construction_standard", v2);
    v3 = await constructionStandard(c, w, { entityId, versionNumber: 3 });
    for (const code of ["ZZ_SECOND_STANDARD", "AA_FIRST_STANDARD"]) await constructionStandard(c, w, { code });
    hettich = await hettichDataset(c, w, { complete: true });
    // 5 articles in total (positions 0–4), so the article list pages.
    for (let i = 1; i < 5; i++) {
      await c.query(`INSERT INTO design_os.hettich_article SELECT org_id, version_id, $2::int, record_code || '-' || $2::int::text, article_number || '-' || $2::int::text, product_family, series, category, description,
        exact_application, dimensions, compatibility, drilling, installation, adjustment, accessories, cad_reference, source_ref, licence_status, licence_usage_notes, verified_by, verified_at, preference_rank
        FROM design_os.hettich_article WHERE version_id = $1 AND position = 0`, [hettich, i]);
    }
    pricing = await pricingStandard(c, w);
    await constructionStandard(c, other, { complete: true });
  });
});
afterAll(async () => {
  await api.close();
});

describe("types", () => {
  it("lists exactly the reference types, with the database's author / approve actions", async () => {
    const r = ReferenceTypeList.parse((await get("", w.users.DESIGNER)).json());
    expect(r.items.map((i) => i.type)).toEqual([...REFERENCE_TYPES]);
    const registry = await sql<{ subject_type: string; author_action: string; approve_action: string }>(
      "SELECT subject_type, author_action, approve_action FROM design_os.versioned_table WHERE subject_type NOT IN ('design', 'manufacturing_standard') ORDER BY subject_type");
    expect(registry.map((x) => x.subject_type)).toEqual([...REFERENCE_TYPES].sort());
    for (const x of registry) expect(r.items.find((i) => i.type === x.subject_type)).toMatchObject({ authorAction: x.author_action, approveAction: x.approve_action });
    expect(r.items.find((i) => i.type === "pricing_standard")?.contentAction).toBe("output.read.cost");
  });
});

describe("entities and versions", () => {
  it("lists entities in code order with their version summaries and the APPROVED / LOCKED candidates", async () => {
    const r = page(ReferenceEntity).parse((await get("/construction_standard/entities", w.users.DESIGNER)).json());
    expect(r.items.map((e) => e.code)).toEqual(["AA_FIRST_STANDARD", "LINTEL_CONSTRUCTION_STANDARD", "ZZ_SECOND_STANDARD"]);
    const main = r.items.find((e) => e.code === "LINTEL_CONSTRUCTION_STANDARD")!;
    expect(main.versionCount).toBe(3);
    expect(main.latestVersion).toMatchObject({ id: v3, versionNumber: 3, status: "DRAFT" });
    expect(main.usableVersions.map((v) => [v.id, v.status])).toEqual([[v2, "APPROVED"]]);
    const one = page(ReferenceEntity).parse((await get("/construction_standard/entities?code=AA_FIRST_STANDARD", w.users.DESIGNER)).json());
    expect(one.items.map((e) => e.code)).toEqual(["AA_FIRST_STANDARD"]);
  });

  it("pages entities with a cursor bound to its collection", async () => {
    const first = page(ReferenceEntity).parse((await get("/construction_standard/entities?limit=2", w.users.DESIGNER)).json());
    expect(first.items.map((e) => e.code)).toEqual(["AA_FIRST_STANDARD", "LINTEL_CONSTRUCTION_STANDARD"]);
    const second = page(ReferenceEntity).parse((await get(`/construction_standard/entities?limit=2&cursor=${first.nextCursor!}`, w.users.DESIGNER)).json());
    expect([second.items.map((e) => e.code), second.nextCursor]).toEqual([["ZZ_SECOND_STANDARD"], null]);
    expect(problem(await get(`/planning_standard/entities?limit=2&cursor=${first.nextCursor!}`, w.users.DESIGNER)).code).toBe("INVALID_CURSOR");
    expect(problem(await get(`/construction_standard/entities?limit=2&cursor=${first.nextCursor!}`, other.users.DESIGNER)).code).toBe("INVALID_CURSOR");
  });

  it("filters versions by entity and exact lifecycle status; SUPERSEDED stays SUPERSEDED", async () => {
    const all = page(ReferenceVersion).parse((await get("/construction_standard/versions?entityCode=LINTEL_CONSTRUCTION_STANDARD", w.users.DESIGNER)).json());
    expect(all.items.map((v) => [v.versionNumber, v.status])).toEqual([[3, "DRAFT"], [2, "APPROVED"], [1, "SUPERSEDED"]]);
    const usable = page(ReferenceVersion).parse((await get("/construction_standard/versions?entityCode=LINTEL_CONSTRUCTION_STANDARD&status=LOCKED,APPROVED", w.users.DESIGNER)).json());
    expect(usable.items.map((v) => v.id)).toEqual([v2]);
    const superseded = usable.items[0]!;
    expect(superseded).toMatchObject({ dataClassification: "PRODUCTION", approvedBy: w.users.DESIGN_HEAD, submittedBy: w.users.PRODUCTION, createdBy: w.users.PRODUCTION });
    expect(superseded.effectiveFrom).not.toBeNull();
    const v1Row = all.items.find((v) => v.id === v1)!;
    expect(v1Row.supersededBy).toBe(v2);
    expect(problem(await get("/construction_standard/versions?status=DONE", w.users.DESIGNER)).code).toBe("VALIDATION_FAILED");
    expect(problem(await get("/design/versions", w.users.DESIGNER)).code).toBe("VALIDATION_FAILED");
    expect(problem(await get("/manufacturing_standard/versions", w.users.DESIGNER)).code).toBe("VALIDATION_FAILED");
  });

  it("returns one exact version with its content, per-value provenance, NULL / UNVERIFIED values and a strong ETag", async () => {
    const r = await get(`/construction_standard/versions/${v2}`, w.users.DESIGNER);
    expect(r.statusCode).toBe(200);
    const d = ReferenceVersionDetail.parse(r.json());
    expect(r.headers.etag).toBe(`"${v2}:${String(d.rowVersion)}"`);
    await seeded(async (c) => { expect(d.contentHash).toBe(await hashOf(c, "construction_standard", v2)); });
    expect(d.content).toEqual({ description: expect.any(String) as string });
    const values = d.children.values!;
    expect(values).toHaveLength(18);
    expect(Object.keys(values[0]!).sort()).toEqual(["evidence_ref", "note", "source", "unit", "value", "variable_code"]);
    expect(values.every((v) => typeof v.value === "number" && typeof v.source === "string")).toBe(true);

    const draft = ReferenceVersionDetail.parse((await get(`/construction_standard/versions/${v3}`, w.users.DESIGNER)).json());
    expect(draft.status).toBe("DRAFT");
    expect(draft.children.values!.every((v) => v.value === null && v.source === null)).toBe(true);
  });
});

describe("Hettich datasets (paged)", () => {
  it("pages articles and calculation rules by position; the detail carries their counts only", async () => {
    const d = ReferenceVersionDetail.parse((await get(`/hettich_dataset/versions/${hettich}`, w.users.PROCUREMENT)).json());
    expect(d.counts).toEqual({ articles: 5, calculationRules: 1 });
    expect(d.children).toEqual({});
    const seen: number[] = [];
    let cursor: string | null = null;
    do {
      const r = page(z.record(z.string(), z.unknown())).parse((await get(`/hettich_dataset/versions/${hettich}/articles?limit=2${cursor === null ? "" : `&cursor=${cursor}`}`, w.users.PROCUREMENT)).json());
      seen.push(...r.items.map((a) => a.position as number));
      expect(r.items.every((a) => a.licence_status === "AUTHORISED" && !("org_id" in a))).toBe(true);
      cursor = r.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual([0, 1, 2, 3, 4]);
    expect(page(z.record(z.string(), z.unknown())).parse((await get(`/hettich_dataset/versions/${hettich}/articles?category=MOUNTING_PLATE`, w.users.PROCUREMENT)).json()).items).toEqual([]);
    expect(page(z.record(z.string(), z.unknown())).parse((await get(`/hettich_dataset/versions/${hettich}/calculation-rules`, w.users.PROCUREMENT)).json()).items).toHaveLength(1);
    expect(problem(await get(`/hettich_dataset/versions/${randomUUID()}/articles`, w.users.PROCUREMENT)).code).toBe("NOT_FOUND");
  });
});

describe("access", () => {
  it("is tenant-safe: another organization's versions do not exist for the caller", async () => {
    expect(problem(await get(`/construction_standard/versions/${v2}`, other.users.DESIGNER)).code).toBe("NOT_FOUND");
    expect(problem(await get(`/hettich_dataset/versions/${hettich}/articles`, other.users.DESIGNER)).code).toBe("NOT_FOUND");
    const theirs = page(ReferenceVersion).parse((await get("/construction_standard/versions", other.users.DESIGNER)).json());
    expect(theirs.items.map((v) => v.id)).not.toContain(v2);
    expect(theirs.items).toHaveLength(1);
  });

  it("needs reference.read and an internal identity; internal cost content additionally needs output.read.cost", async () => {
    expect(problem(await get("/construction_standard/versions", w.users.CLIENT)).code).toBe("IDENTITY_KIND_MISMATCH");
    // The organization's own role → action grants decide: without reference.read, no reference data.
    await sql("DELETE FROM design_os.role_permission WHERE org_id = $1 AND role = 'SITE_ENGINEER' AND action = 'reference.read'", [w.org]);
    expect(problem(await get("/construction_standard/versions", w.users.SITE_ENGINEER)).code).toBe("PERMISSION_DENIED");
    // Metadata is reference data; the rates themselves are cost data.
    expect(page(ReferenceVersion).parse((await get("/pricing_standard/versions", w.users.DESIGNER)).json()).items.map((v) => v.id)).toContain(pricing);
    expect(problem(await get(`/pricing_standard/versions/${pricing}`, w.users.DESIGNER)).code).toBe("PERMISSION_DENIED");
    const costing = ReferenceVersionDetail.parse((await get(`/pricing_standard/versions/${pricing}`, w.users.COSTING)).json());
    expect(costing.content).toMatchObject({ currency: "INR", gst_pct: null, margin_pct: null });
    expect(costing.children.rateCardLines!.every((l) => l.rate_paise === null)).toBe(true);
  });

  it("is read-only: no route writes reference data, and the lifecycle changes only through transition()", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const r = await api.request({ method, url: `/api/v1/reference-data/construction_standard/versions/${v3}`, as: w.users.PRODUCTION, payload: { status: "APPROVED" } });
      expect([404, 405]).toContain(r.statusCode);
    }
    await seeded(async (c) => { await transition(c, w, "PRODUCTION", "construction_standard", v3, "SUBMIT"); });
    const r = ReferenceVersionDetail.parse((await get(`/construction_standard/versions/${v3}`, w.users.DESIGNER)).json());
    expect([r.status, r.submittedBy]).toEqual(["IN_REVIEW", w.users.PRODUCTION]);
  });

  it("never exposes TEST_FIXTURE data: the database refuses any non-PRODUCTION reference row", async () => {
    await expect(sql("UPDATE design_os.construction_standard_version SET data_classification = 'TEST_FIXTURE' WHERE id = $1", [v3])).rejects.toThrow();
    const listed = page(ReferenceVersion).parse((await get("/construction_standard/versions?limit=200", w.users.DESIGNER)).json());
    expect(new Set(listed.items.map((v) => v.dataClassification as string))).toEqual(new Set(["PRODUCTION"]));
  });
});
