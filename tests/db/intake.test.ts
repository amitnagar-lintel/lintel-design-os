/**
 * Reference-data intake (M6 G2) against PostgreSQL 17 (LOCAL / CI only). Uses its OWN throw-away database (created,
 * migrated by the runner and dropped here), because an intake commits: the shared test database must stay empty.
 * Complete values come only from ./support/synthetic.ts (test-only, never Lintel values).
 *
 * Covers: import as the named author through RLS, audit, deterministic re-import (UNCHANGED), dry run, version
 * conflicts / duplicates / gaps, author permission and tenant isolation, dependencies (existence and lifecycle),
 * TEST_FIXTURE refusal, production-candidate completeness, and SUBMIT / APPROVE only through transition().
 */
import { KIT_BASE_STANDARD, KITCHEN_BASE_STANDARD_V1, LINTEL_CONSTRUCTION_STANDARD_DRAFT, LINTEL_PLANNING_STANDARD_DRAFT, MATERIALS } from "@lintel/catalog-engine";
import { HETTICH_PRODUCTION_DATASET, HETTICH_TEST_FIXTURE_DATASET } from "@lintel/hettich-engine";
import { LINTEL_PRODUCTION_PRICING_RULES, LINTEL_PRODUCTION_RATE_CARD } from "@lintel/pricing-engine";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { run } from "../../apps/db-tools/src/intake/intake-cli.js";
import type { ImportSummary } from "../../apps/db-tools/src/intake/importer.js";
import { importIntake, stableUuid, TABLES } from "../../apps/db-tools/src/intake/importer.js";
import { verifierFromEnv } from "../../apps/db-tools/src/intake/approver-token.js";
import { transitionVersion, versionState } from "../../apps/db-tools/src/intake/lifecycle.js";
import type { Validated } from "../../apps/db-tools/src/intake/spec.js";
import { validateIntake } from "../../apps/db-tools/src/intake/spec.js";
import { loadMigrations } from "../../apps/db-tools/src/migrations.js";
import { up } from "../../apps/db-tools/src/runner.js";
import { intakeFile } from "../../apps/db-tools/test/support/intake-files.js";
import { TEST_AUTH_ENV, testToken } from "../../apps/db-tools/test/support/tokens.js";
import type { Tx } from "./support/db.js";
import { applyBootstrap } from "./support/migrate.js";
import { syntheticConstruction, syntheticHettichDataset, syntheticProvenance } from "./support/synthetic.js";
import type { World } from "./support/world.js";
import { createWorld } from "./support/world.js";

const DB = `design_os_intake_${String(process.pid)}`;
let url = "";
let client: pg.Client;
let w: World;
let other: World;
const email: Record<string, string> = {};
const ORG = "INTAKE_ORG";
const verify = verifierFromEnv(TEST_AUTH_ENV);

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: inject("dbUrl") });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  await admin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${DB}`);
  });
  const u = new URL(inject("dbUrl"));
  u.pathname = `/${DB}`;
  url = u.toString();
  client = new pg.Client({ connectionString: url });
  await client.connect();
  await applyBootstrap(client);
  expect((await up(client, loadMigrations())).outcome).toBe("APPLIED");
  await client.query("BEGIN");
  w = await createWorld(client as unknown as Tx, ORG);
  other = await createWorld(client as unknown as Tx, "INTAKE_OTHER");
  await client.query("COMMIT");
  for (const [role, id] of Object.entries(w.users)) {
    email[role] = (await client.query<{ email: string }>("SELECT email FROM design_os.app_user WHERE id = $1", [id])).rows[0]!.email;
  }
});
afterAll(async () => {
  await client.end();
  await admin((c) => c.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`));
});

const validated = (bytes: string): Validated => {
  const v = validateIntake(bytes);
  if (v.file === null) throw new Error(`not parseable: ${JSON.stringify(v.findings)}`);
  return v;
};
const importAs = (bytes: string, role: string, o: { dryRun?: boolean; org?: string; emailOf?: string } = {}): Promise<ImportSummary> =>
  importIntake(client, loadMigrations(), validated(bytes), { orgCode: o.org ?? ORG, authorEmail: o.emailOf ?? email[role]!, operator: "ci-operator", dryRun: o.dryRun ?? false });
const count = async (sql: string, params: unknown[] = []) => Number((await client.query<{ n: string }>(sql, params)).rows[0]?.n);

const constructionDraft = (versionNumber = 1) => intakeFile("construction_standard", LINTEL_CONSTRUCTION_STANDARD_DRAFT.standardId, LINTEL_CONSTRUCTION_STANDARD_DRAFT, { versionNumber });
const candidateSourceRef = { url: null, documentTitle: "Test drawing set", documentVersion: "A", sourceDate: "2026-09-26" };
const constructionCandidate = (versionNumber: number) => {
  const s = syntheticConstruction(LINTEL_CONSTRUCTION_STANDARD_DRAFT);
  const provenance = Object.fromEntries(Object.entries(syntheticProvenance(Object.keys(s.variables))).map(([k, p]) => [k, { ...p, evidenceRef: `EVIDENCE-${k}` }]));
  return intakeFile("construction_standard", s.standardId, s, { versionNumber, intent: "PRODUCTION_CANDIDATE", provenance, sourceRef: candidateSourceRef });
};

describe("schema parity", () => {
  it("the intake's version / entity tables are exactly the database registry's", async () => {
    const reg = (await client.query<{ subject_type: string; version_table: string; entity_table: string }>(
      "SELECT subject_type, version_table::text AS version_table, entity_table::text AS entity_table FROM design_os.versioned_table")).rows;
    for (const [type, t] of Object.entries(TABLES)) {
      expect(reg.find((r) => r.subject_type === type)).toEqual({ subject_type: type, version_table: `design_os.${t.version}`, entity_table: `design_os.${t.entity}` });
    }
  });
});

describe("import", () => {
  it("writes one DRAFT version as the named author, through RLS, with provenance and an audit trail", async () => {
    const s = await importAs(constructionDraft(), "PRODUCTION");
    expect(s).toMatchObject({ outcome: "CREATED", type: "construction_standard", entityCode: "LINTEL_CONSTRUCTION_STANDARD", versionNumber: 1, author: email.PRODUCTION, operator: "ci-operator" });
    expect(s.rows).toEqual({ construction_standard: 1, construction_standard_version: 1, construction_standard_value: 15 });
    expect(s.findings.filter((f) => f.level === "UNVERIFIED")).toHaveLength(15);
    expect([s.entityId, s.versionId]).toEqual([stableUuid(w.org, "construction_standard", "LINTEL_CONSTRUCTION_STANDARD"), stableUuid(w.org, "construction_standard", "LINTEL_CONSTRUCTION_STANDARD", "1")]);
    const row = (await client.query("SELECT status::text, data_classification, created_by, content_hash, source, change_reason FROM design_os.construction_standard_version WHERE id = $1", [s.versionId])).rows[0] as Record<string, unknown>;
    expect(row).toEqual({ status: "DRAFT", data_classification: "PRODUCTION", created_by: w.users.PRODUCTION, content_hash: s.contentHash, source: LINTEL_CONSTRUCTION_STANDARD_DRAFT.source, change_reason: "Test intake" });
    expect(await count("SELECT count(*) AS n FROM design_os.construction_standard_value WHERE version_id = $1 AND value IS NULL", [s.versionId])).toBe(15);
    const audit = (await client.query<{ actor_user_id: string; reason: string }>("SELECT DISTINCT actor_user_id, reason FROM design_os.audit_log WHERE org_id = $1 AND table_name LIKE 'construction_standard%'", [w.org])).rows;
    expect(audit).toEqual([{ actor_user_id: w.users.PRODUCTION, reason: expect.stringMatching(/^reference-data intake construction_standard LINTEL_CONSTRUCTION_STANDARD v1 \(WORKING_DRAFT\) file sha256:[0-9a-f]{64} by operator ci-operator$/) as string }]);
    expect((await client.query<{ ok: boolean }>("SELECT ok FROM design_os.verify_audit_chain($1)", [w.org])).rows[0]?.ok).toBe(true);
  });

  it("is deterministic: the same file again is UNCHANGED and writes nothing; a dry run writes nothing", async () => {
    const before = await count("SELECT count(*) AS n FROM design_os.audit_log");
    const again = await importAs(constructionDraft(), "PRODUCTION");
    expect([again.outcome, again.rows, again.versionId]).toEqual(["UNCHANGED", {}, stableUuid(w.org, "construction_standard", "LINTEL_CONSTRUCTION_STANDARD", "1")]);
    const dry = await importAs(constructionCandidate(2), "PRODUCTION", { dryRun: true });
    expect([dry.outcome, dry.rows]).toEqual(["WOULD_CREATE", { construction_standard_version: 1, construction_standard_value: 15 }]);
    expect(await count("SELECT count(*) AS n FROM design_os.construction_standard_version")).toBe(1);
    expect(await count("SELECT count(*) AS n FROM design_os.audit_log")).toBe(before);
  });

  it("refuses conflicting versions, duplicated content and version gaps", async () => {
    const changed = intakeFile("construction_standard", LINTEL_CONSTRUCTION_STANDARD_DRAFT.standardId, { ...LINTEL_CONSTRUCTION_STANDARD_DRAFT, description: "changed" }, { versionNumber: 1 });
    expect((await importAs(changed, "PRODUCTION")).findings.map((f) => f.code)).toContain("VERSION_CONFLICT");
    expect((await importAs(constructionDraft(2), "PRODUCTION")).findings.map((f) => f.code)).toContain("DUPLICATE_CONTENT");
    expect((await importAs(constructionCandidate(3), "PRODUCTION")).findings.map((f) => f.code)).toContain("VERSION_NOT_NEXT");
    expect(await count("SELECT count(*) AS n FROM design_os.construction_standard_version")).toBe(1);
  });

  it("only an active internal member holding the type's author action of that organization can import", async () => {
    expect((await importAs(constructionCandidate(2), "DESIGNER")).findings.map((f) => f.code)).toContain("AUTHOR_NOT_PERMITTED");
    expect((await importAs(constructionCandidate(2), "CLIENT")).findings.map((f) => f.code)).toContain("AUTHOR_NOT_MEMBER");
    expect((await importAs(constructionCandidate(2), "", { emailOf: "nobody@lintel.example" })).findings.map((f) => f.code)).toContain("AUTHOR_NOT_MEMBER");
    // A member of another organization cannot write into this one, and this one's data is invisible to theirs.
    const otherEmail = (await client.query<{ email: string }>("SELECT email FROM design_os.app_user WHERE id = $1", [other.users.PRODUCTION])).rows[0]!.email;
    expect((await importAs(constructionCandidate(2), "", { emailOf: otherEmail })).findings.map((f) => f.code)).toContain("AUTHOR_NOT_MEMBER");
    await client.query("BEGIN");
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: other.users.PRODUCTION, org_id: other.org })]);
    await client.query("SET LOCAL ROLE design_os_api");
    expect(await count("SELECT count(*) AS n FROM design_os.construction_standard_version")).toBe(0);
    await client.query("ROLLBACK");
  });

  it("refuses TEST_FIXTURE data before any database access", async () => {
    const v = validateIntake(intakeFile("hettich_dataset", HETTICH_TEST_FIXTURE_DATASET.datasetId, HETTICH_TEST_FIXTURE_DATASET));
    expect(v.accepted).toBe(false);
    if (v.file !== null) expect((await importIntake(client, loadMigrations(), v, { orgCode: ORG, authorEmail: email.PROCUREMENT!, operator: "ci", dryRun: false })).outcome).toBe("REFUSED");
    expect(await count("SELECT count(*) AS n FROM design_os.hettich_dataset_version")).toBe(0);
    await expect(client.query("UPDATE design_os.construction_standard_version SET data_classification = 'TEST_FIXTURE'")).rejects.toThrow(/production_only/);
  });
});

describe("dependencies", () => {
  it("a product needs its exact recipe version; a production candidate needs it APPROVED / LOCKED", async () => {
    const product = (intent: "WORKING_DRAFT" | "PRODUCTION_CANDIDATE") => intakeFile("product", KIT_BASE_STANDARD.productId, KIT_BASE_STANDARD, { recipe: { entityCode: KITCHEN_BASE_STANDARD_V1.recipeId, versionNumber: 1 }, source: "Lintel catalog", intent, sourceRef: candidateSourceRef });
    expect((await importAs(product("WORKING_DRAFT"), "DESIGN_HEAD")).findings.map((f) => f.code)).toContain("DEPENDENCY_MISSING");
    const recipe = await importAs(intakeFile("construction_recipe", KITCHEN_BASE_STANDARD_V1.recipeId, KITCHEN_BASE_STANDARD_V1, { source: "Lintel catalog" }), "DESIGN_HEAD");
    expect(recipe.outcome).toBe("CREATED");
    const created = await importAs(product("WORKING_DRAFT"), "DESIGN_HEAD");
    expect([created.outcome, created.findings.filter((f) => f.code === "LIMIT_UNVERIFIED").length > 0]).toEqual(["CREATED", true]);
    const row = (await client.query<{ recipe_version_id: string }>("SELECT recipe_version_id FROM design_os.product_version WHERE id = $1", [created.versionId])).rows[0];
    expect(row?.recipe_version_id).toBe(recipe.versionId);
  });

  it("a catalog version lists exact existing item versions (resolved to ids)", async () => {
    const m = MATERIALS[0]!;
    expect((await importAs(intakeFile("material", m.materialId, m), "PROCUREMENT")).outcome).toBe("CREATED");
    const catalog = (members: { itemType: string; entityCode: string; versionNumber: number }[]) =>
      intakeFile("material_catalog", "LINTEL_MATERIAL_CATALOG", { versionLabel: "2026.09-draft", description: "Material catalog", members }, { source: "Lintel catalog" });
    expect((await importAs(catalog([{ itemType: "material", entityCode: m.materialId, versionNumber: 2 }]), "PROCUREMENT")).findings.map((f) => f.code)).toContain("DEPENDENCY_MISSING");
    const s = await importAs(catalog([{ itemType: "material", entityCode: m.materialId, versionNumber: 1 }]), "PROCUREMENT");
    expect([s.outcome, s.rows]).toEqual(["CREATED", { material_catalog: 1, material_catalog_version: 1, material_catalog_version_material: 1, material_catalog_version_edge_band: 0 }]);
  });

  it("a pricing standard is imported by COSTING only; its rates stay NULL / UNVERIFIED", async () => {
    const file = intakeFile("pricing_standard", "LINTEL_PRICING_STANDARD", { rateCard: LINTEL_PRODUCTION_RATE_CARD, rules: LINTEL_PRODUCTION_PRICING_RULES });
    expect((await importAs(file, "PRODUCTION")).findings.map((f) => f.code)).toContain("AUTHOR_NOT_PERMITTED");
    const s = await importAs(file, "COSTING");
    expect(s.outcome).toBe("CREATED");
    expect(await count("SELECT count(*) AS n FROM design_os.rate_card_line WHERE version_id = $1 AND rate_paise IS NOT NULL", [s.versionId])).toBe(0);
  });

  it("an empty Hettich dataset is a working draft; an uncleared licence is never a production candidate", async () => {
    expect((await importAs(intakeFile("hettich_dataset", HETTICH_PRODUCTION_DATASET.datasetId, HETTICH_PRODUCTION_DATASET, { source: "Hettich intake" }), "PROCUREMENT")).outcome).toBe("CREATED");
    const uncleared = syntheticHettichDataset(HETTICH_PRODUCTION_DATASET, { licence: "UNKNOWN" });
    const v = validateIntake(intakeFile("hettich_dataset", uncleared.datasetId, uncleared, { versionNumber: 2, source: "Hettich intake", intent: "PRODUCTION_CANDIDATE", sourceRef: candidateSourceRef }));
    expect(v.findings.map((f) => f.code)).toEqual(expect.arrayContaining(["LICENCE_NOT_CLEARED", "INCOMPLETE_PRODUCTION_DATA"]));
  });
});

describe("lifecycle: only through transition()", () => {
  it("a complete candidate is submitted by its named author and approved only by a different, AUTHENTICATED approver stating the reviewed hash", async () => {
    const s = await importAs(constructionCandidate(2), "PRODUCTION");
    expect(s.outcome).toBe("CREATED");
    const o = { orgCode: ORG, type: "construction_standard" as const, entityCode: "LINTEL_CONSTRUCTION_STANDARD", versionNumber: 2, operator: "ci-operator", reason: "reviewed against the drawing set" };
    expect((await versionState(client, ORG, "construction_standard", "LINTEL_CONSTRUCTION_STANDARD", 2))?.approvalProblems).toEqual([]);

    const named = (role: string) => ({ kind: "named" as const, email: email[role]! });
    const authenticated = async (userId: string, t: { expiresIn?: string; secret?: string; role?: string } = {}) => ({ kind: "authenticated" as const, token: await testToken(userId, t), verify });

    // The incomplete working draft (v1) can never be put up for approval.
    const incomplete = await transitionVersion(client, "SUBMIT", { ...o, versionNumber: 1, actor: named("PRODUCTION") });
    expect(incomplete).toMatchObject({ outcome: "REFUSED", code: "INCOMPLETE_PRODUCTION_DATA" });
    expect(incomplete.outcome === "REFUSED" && incomplete.state?.approvalProblems.length).toBe(15);

    // SUBMIT keeps the operator-named draft author.
    expect(await transitionVersion(client, "SUBMIT", { ...o, actor: named("DESIGNER") })).toMatchObject({ outcome: "REFUSED", code: "LD001" });
    expect(await transitionVersion(client, "SUBMIT", { ...o, actor: named("PRODUCTION") })).toMatchObject({ outcome: "DONE", authenticated: false, after: { status: "IN_REVIEW", submittedBy: w.users.PRODUCTION } });

    // APPROVE never trusts an operator-named email — not even the right approver's.
    expect(await transitionVersion(client, "APPROVE", { ...o, actor: named("DESIGN_HEAD"), expectedContentHash: s.contentHash! })).toMatchObject({ outcome: "REFUSED", code: "AUTHENTICATED_APPROVER_REQUIRED" });
    // Only a token that verifies: a forged, expired or non-`authenticated` token is refused before the database is touched.
    expect(await transitionVersion(client, "APPROVE", { ...o, actor: await authenticated(w.users.DESIGN_HEAD, { secret: "someone-elses-secret-0123456789abcdef" }), expectedContentHash: s.contentHash! })).toMatchObject({ outcome: "REFUSED", code: "APPROVER_NOT_AUTHENTICATED" });
    expect(await transitionVersion(client, "APPROVE", { ...o, actor: await authenticated(w.users.DESIGN_HEAD, { expiresIn: "-1m" }), expectedContentHash: s.contentHash! })).toMatchObject({ outcome: "REFUSED", code: "APPROVER_NOT_AUTHENTICATED" });
    expect(await transitionVersion(client, "APPROVE", { ...o, actor: await authenticated(w.users.DESIGN_HEAD, { role: "service_role" }), expectedContentHash: s.contentHash! })).toMatchObject({ outcome: "REFUSED", code: "APPROVER_NOT_AUTHENTICATED" });
    // The authenticated user must be an active internal member of THIS organization.
    expect(await transitionVersion(client, "APPROVE", { ...o, actor: await authenticated(other.users.DESIGN_HEAD), expectedContentHash: s.contentHash! })).toMatchObject({ outcome: "REFUSED", code: "ACTOR_NOT_MEMBER" });
    // The database rules still apply to the authenticated approver: the reviewed hash, approver ≠ submitter, the approve action.
    expect(await transitionVersion(client, "APPROVE", { ...o, actor: await authenticated(w.users.DESIGN_HEAD) })).toMatchObject({ outcome: "REFUSED", code: "CONTENT_HASH_REQUIRED" });
    expect(await transitionVersion(client, "APPROVE", { ...o, actor: await authenticated(w.users.PRODUCTION), expectedContentHash: s.contentHash! })).toMatchObject({ outcome: "REFUSED", code: "LD004" });
    expect(await transitionVersion(client, "APPROVE", { ...o, actor: await authenticated(w.users.DESIGN_HEAD), expectedContentHash: `sha256:${"0".repeat(64)}` })).toMatchObject({ outcome: "REFUSED", code: "LD007" });
    expect(await transitionVersion(client, "APPROVE", { ...o, actor: await authenticated(w.users.SALES), expectedContentHash: s.contentHash! })).toMatchObject({ outcome: "REFUSED", code: "LD001" });
    const approved = await transitionVersion(client, "APPROVE", { ...o, actor: await authenticated(w.users.DESIGN_HEAD), expectedContentHash: s.contentHash! });
    expect(approved).toMatchObject({ outcome: "DONE", authenticated: true, actorUserId: w.users.DESIGN_HEAD, after: { status: "APPROVED", approvedBy: w.users.DESIGN_HEAD, submittedBy: w.users.PRODUCTION } });
    expect(approved.outcome === "DONE" && approved.after.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The decision record: who did what, with the operator-named reason, in the hash-chained audit log.
    const decisions = await client.query<{ action: string; decided_by: string; reason: string }>(
      "SELECT action, decided_by, reason FROM design_os.approval_decision WHERE subject_type = 'construction_standard' AND subject_id = $1 ORDER BY id", [s.versionId]);
    expect(decisions.rows).toEqual([
      { action: "SUBMIT", decided_by: w.users.PRODUCTION, reason: "reviewed against the drawing set" },
      { action: "APPROVE", decided_by: w.users.DESIGN_HEAD, reason: "reviewed against the drawing set" },
    ]);
    // The incomplete v1 is untouched: still the DRAFT it was imported as.
    expect((await versionState(client, ORG, "construction_standard", "LINTEL_CONSTRUCTION_STANDARD", 1))?.status).toBe("DRAFT");
  });
});

describe("CLI", () => {
  it("validate / import / status / submit with deterministic JSON and exit codes; a pooler URL is refused", async () => {
    const io = (readFile: (p: string) => string, env: Record<string, string> = { MIGRATION_DATABASE_URL: url }) => {
      const out: string[] = [];
      const err: string[] = [];
      return { out, err, io: { env, out: (l: string) => out.push(l), err: (l: string) => err.push(l), readFile } };
    };
    const planning = intakeFile("planning_standard", LINTEL_PLANNING_STANDARD_DRAFT.standardId, LINTEL_PLANNING_STANDARD_DRAFT);
    let t = io(() => planning);
    expect(await run(["validate", "--file", "planning.json", "--json"], t.io)).toBe(0);
    const report = JSON.parse(t.out[0]!) as { accepted: boolean; findings: unknown[] };
    t = io(() => planning);
    await run(["validate", "--file", "planning.json", "--json"], t.io);
    expect(JSON.parse(t.out[0]!)).toEqual(report);
    expect(report.accepted).toBe(true);

    t = io(() => "{");
    expect(await run(["validate", "--file", "bad.json"], t.io)).toBe(5);

    const args = ["import", "--file", "planning.json", "--env", "ci", "--org", ORG, "--as", email.PRODUCTION!, "--operator", "ci-operator", "--json"];
    t = io(() => planning);
    expect(await run([...args, "--dry-run"], t.io)).toBe(0);
    expect(JSON.parse(t.out[0]!)).toMatchObject({ outcome: "WOULD_CREATE" });
    t = io(() => planning);
    expect(await run(args, t.io)).toBe(0);
    const created = JSON.parse(t.out[0]!) as ImportSummary;
    expect(created.outcome).toBe("CREATED");
    t = io(() => planning);
    expect(await run(args, t.io)).toBe(0);
    expect(JSON.parse(t.out[0]!)).toMatchObject({ outcome: "UNCHANGED", versionId: created.versionId, contentHash: created.contentHash });

    t = io(() => planning);
    expect(await run(["status", "--org", ORG, "--type", "planning_standard", "--entity", LINTEL_PLANNING_STANDARD_DRAFT.standardId, "--version", "1", "--json"], t.io)).toBe(0);
    expect(JSON.parse(t.out[0]!)).toMatchObject({ status: "DRAFT", contentHash: created.contentHash, approvalProblems: expect.arrayContaining([expect.objectContaining({ code: "CONTENT_INCOMPLETE" })]) as unknown[] });
    t = io(() => planning);
    expect(await run(["submit", "--env", "ci", "--org", ORG, "--type", "planning_standard", "--entity", LINTEL_PLANNING_STANDARD_DRAFT.standardId, "--version", "1", "--as", email.PRODUCTION!, "--operator", "ci", "--reason", "x"], t.io)).toBe(4);

    // approve: never --as; only the approver's own verified access token; the audit uses that user's id.
    const approveArgs = ["approve", "--env", "ci", "--org", ORG, "--type", "construction_standard", "--entity", "LINTEL_CONSTRUCTION_STANDARD", "--version", "2", "--operator", "ci", "--reason", "x", "--expected-content-hash", `sha256:${"0".repeat(64)}`];
    t = io(() => planning);
    expect(await run([...approveArgs, "--as", email.DESIGN_HEAD!], t.io)).toBe(64);
    expect(t.err[0]).toMatch(/never takes --as/);
    t = io(() => planning);
    expect(await run(approveArgs, t.io)).toBe(64);
    expect(t.err[0]).toMatch(/access token/);
    t = io(() => planning, { MIGRATION_DATABASE_URL: url, APPROVER_ACCESS_TOKEN: await testToken(w.users.DESIGN_HEAD) });
    expect(await run(approveArgs, t.io)).toBe(4);
    expect(t.err[0]).toMatch(/AUTH_ISSUER/); // no verification settings: refused, never trusted
    const token = await testToken(w.users.DESIGN_HEAD);
    t = io((p) => (p === "token.txt" ? `${token}\n` : planning), { MIGRATION_DATABASE_URL: url, ...TEST_AUTH_ENV });
    expect(await run([...approveArgs, "--access-token-file", "token.txt", "--json"], t.io)).toBe(4);
    // Verified as DESIGN_HEAD; v2 is already APPROVED, so the database refuses the transition itself.
    expect(JSON.parse(t.out[0]!)).toMatchObject({ outcome: "REFUSED", code: "LD006" });

    // Migrations and intake never use a Supabase pooler; hosted targets need --confirm.
    t = io(() => planning, { MIGRATION_DATABASE_URL: "postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres" });
    expect(await run(["import", "--file", "p.json", "--env", "production", "--confirm", "abcdefghijklmnopqrst", "--org", ORG, "--as", "a@b.c", "--operator", "x"], t.io)).toBe(4);
    expect(t.err[0]).toMatch(/direct connection/);
    t = io(() => planning, { MIGRATION_DATABASE_URL: "postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres" });
    expect(await run(["import", "--file", "p.json", "--env", "production", "--org", ORG, "--as", "a@b.c", "--operator", "x"], t.io)).toBe(4);
    expect(t.err[0]).toMatch(/--confirm/);
  });
});
