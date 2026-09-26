/**
 * Database test setup (LOCAL / CI PostgreSQL 17 only). Creates a fresh database, applies the CI Supabase
 * stand-ins, then: all migrations up → all down (schema must be gone) → all up again. The results are handed
 * to the tests, which assert them. Requires DATABASE_URL (an admin connection); never a hosted project.
 */
import pg from "pg";
import type { TestProject } from "vitest/node";
import { applyBootstrap, appliedVersions, loadMigrations, migrateDown, migrateUp } from "./migrate.js";
import { schemaSnapshot } from "./schema-snapshot.js";

export interface MigrationReport {
  readonly migrations: readonly string[];
  readonly firstUp: readonly string[];
  readonly down: readonly string[];
  readonly schemaLeftAfterDown: number;
  readonly appliedAfterDown: readonly string[];
  readonly secondUp: readonly string[];
  readonly snapshotsIdentical: boolean;
}

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
    migrationReport: MigrationReport;
  }
}

const TEST_DB = "design_os_test";

export default async function setup(project: TestProject): Promise<void> {
  const admin = process.env.DATABASE_URL;
  if (admin === undefined || admin === "") throw new Error("DATABASE_URL (admin connection to a LOCAL/CI PostgreSQL 17) is required for tests/db");
  if (/supabase\.(co|com)/i.test(admin)) throw new Error("tests/db must never run against a hosted Supabase project");

  const root = new pg.Client({ connectionString: admin });
  await root.connect();
  await root.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await root.query(`CREATE DATABASE ${TEST_DB}`);
  await root.end();

  const url = new URL(admin);
  url.pathname = `/${TEST_DB}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await applyBootstrap(client);
    const firstUp = await migrateUp(client);
    const before = await schemaSnapshot(client);
    const down = await migrateDown(client);
    const left = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM pg_namespace WHERE nspname = 'design_os'");
    const appliedAfterDown = await appliedVersions(client);
    const secondUp = await migrateUp(client);
    const after = await schemaSnapshot(client);
    project.provide("migrationReport", {
      migrations: loadMigrations().map((m) => m.version),
      firstUp,
      down,
      schemaLeftAfterDown: Number(left.rows[0]?.n ?? -1),
      appliedAfterDown,
      secondUp,
      snapshotsIdentical: before === after,
    });
    project.provide("dbUrl", url.toString());
  } finally {
    await client.end();
  }
}
