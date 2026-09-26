/** Migration discipline: every migration has a rollback, rollback empties the schema, re-apply is identical, and no drift. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, inject, it } from "vitest";
import { loadMigrations } from "./support/migrate.js";
import { schemaSnapshot } from "./support/schema-snapshot.js";

const SNAPSHOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "database", "schema", "design_os.schema.txt");
const EXPECTED = ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010", "0011"];

describe("migrations 0001 → 0011", () => {
  const report = inject("migrationReport");
  it("are exactly 0001 … 0011, each with a rollback", () => {
    expect(loadMigrations().map((m) => m.version)).toEqual(EXPECTED);
    expect(report.migrations).toEqual(EXPECTED);
  });
  it("apply in order, roll back in reverse to an empty schema, and re-apply", () => {
    expect(report.firstUp).toEqual(EXPECTED);
    expect(report.down).toEqual([...EXPECTED].reverse());
    expect(report.schemaLeftAfterDown).toBe(0);
    expect(report.appliedAfterDown).toEqual([]);
    expect(report.secondUp).toEqual(EXPECTED);
  });
  it("re-applying after a rollback produces an identical schema", () => {
    expect(report.snapshotsIdentical).toBe(true);
  });
  it("the schema matches the committed snapshot (no drift)", async () => {
    const client = new pg.Client({ connectionString: inject("dbUrl") });
    await client.connect();
    const actual = await schemaSnapshot(client);
    await client.end();
    if (process.env.UPDATE_SCHEMA_SNAPSHOT === "1") writeFileSync(SNAPSHOT, actual);
    expect(existsSync(SNAPSHOT)).toBe(true);
    expect(actual).toBe(readFileSync(SNAPSHOT, "utf8"));
  });
  it("seeds only schema: roles, actions, default grants and variable codes — no production values", async () => {
    const client = new pg.Client({ connectionString: inject("dbUrl") });
    await client.connect();
    const count = async (sql: string) => Number((await client.query<{ n: string }>(sql)).rows[0]?.n);
    expect(await count("SELECT count(*) AS n FROM design_os.construction_variable")).toBe(12);
    expect(await count("SELECT count(*) AS n FROM design_os.planning_variable")).toBe(6);
    expect(await count("SELECT count(*) AS n FROM design_os.manufacturing_variable")).toBe(0);
    expect(await count("SELECT count(*) AS n FROM design_os.role")).toBe(10);
    // Nothing but schema registries holds rows after migrating: no organizations, versions, values or content.
    const registries = new Set(["versioned_table", "role", "permission", "default_role_permission", "construction_variable", "planning_variable", "manufacturing_variable"]);
    const tables = (await client.query<{ t: string }>("SELECT tablename AS t FROM pg_tables WHERE schemaname = 'design_os'")).rows.map((r) => r.t).filter((t) => !registries.has(t));
    expect(tables.length).toBeGreaterThan(80);
    for (const t of tables) expect([t, await count(`SELECT count(*) AS n FROM design_os.${t}`)]).toEqual([t, 0]);
    await client.end();
  });
});
