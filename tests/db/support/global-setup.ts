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
    raceDbUrl: string;
    /** The race database, logged in as the API's test login role (member of design_os_api, NOINHERIT). */
    apiDbUrl: string;
    migrationReport: MigrationReport;
  }
}

const TEST_DB = "design_os_test";
/** A copy of the migrated test database for the few tests that must COMMIT across connections (races); dropped at teardown. */
const RACE_DB = "design_os_race";
const API_LOGIN = "lintel_api_test";

/** Registries and seeded grants: the only tables allowed to hold rows when the suite ends. */
const SCHEMA_TABLES = new Set(["versioned_table", "role", "permission", "default_role_permission", "construction_variable", "planning_variable", "manufacturing_variable", "error_code", "output_purpose_rule"]);

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const admin = process.env.DATABASE_URL;
  if (admin === undefined || admin === "") throw new Error("DATABASE_URL (admin connection to a LOCAL/CI PostgreSQL 17) is required for tests/db");
  if (/supabase\.(co|com)/i.test(admin)) throw new Error("tests/db must never run against a hosted Supabase project");

  const root = new pg.Client({ connectionString: admin });
  await root.connect();
  await root.query(`DROP DATABASE IF EXISTS ${RACE_DB} WITH (FORCE)`);
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
  const raceUrl = new URL(admin);
  raceUrl.pathname = `/${RACE_DB}`;
  const templater = new pg.Client({ connectionString: admin });
  await templater.connect();
  await templater.query(`CREATE DATABASE ${RACE_DB} TEMPLATE ${TEST_DB}`);
  await templater.end();
  project.provide("raceDbUrl", raceUrl.toString());

  // The API logs in with its own role whose ONLY privilege is membership in design_os_api (NOINHERIT: it must
  // `SET ROLE design_os_api`, so the login role itself can read nothing). Cluster-level; LOCAL / CI only.
  const roles = new pg.Client({ connectionString: admin });
  await roles.connect();
  await roles.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${API_LOGIN}') THEN CREATE ROLE ${API_LOGIN} LOGIN NOINHERIT PASSWORD '${API_LOGIN}'; END IF;
  END $$`);
  await roles.query(`GRANT design_os_api TO ${API_LOGIN}`);
  await roles.end();
  const apiUrl = new URL(raceUrl.toString());
  apiUrl.username = API_LOGIN;
  apiUrl.password = API_LOGIN;
  project.provide("apiDbUrl", apiUrl.toString());

  // Teardown: every test ran in a rolled-back transaction, so no data (synthetic or otherwise) may persist.
  return async () => {
    const check = new pg.Client({ connectionString: url.toString() });
    await check.connect();
    try {
      const tables = (await check.query<{ t: string }>("SELECT tablename AS t FROM pg_tables WHERE schemaname = 'design_os' ORDER BY 1")).rows.map((r) => r.t);
      const left: string[] = [];
      for (const t of tables) {
        if (SCHEMA_TABLES.has(t)) continue;
        const n = Number((await check.query<{ n: string }>(`SELECT count(*)::text AS n FROM design_os.${t}`)).rows[0]?.n ?? 0);
        if (n > 0) left.push(`${t}: ${n}`);
      }
      if (left.length > 0) throw new Error(`database tests left persistent rows behind: ${left.join(", ")}`);
    } finally {
      await check.end();
      const dropper = new pg.Client({ connectionString: admin });
      await dropper.connect();
      await dropper.query(`DROP DATABASE IF EXISTS ${RACE_DB} WITH (FORCE)`);
      await dropper.end();
    }
  };
}
