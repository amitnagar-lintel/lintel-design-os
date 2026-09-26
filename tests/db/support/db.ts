/** Connection and transaction helpers for database tests. Every test runs in a transaction that is rolled back. */
import { inject } from "vitest";
import pg from "pg";

// numeric → number, bigint → number, timestamptz → ISO string (the persistence row types use these).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => new Date(v).toISOString());

let pool: pg.Pool | null = null;
export function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: inject("dbUrl"), max: 4 });
  return pool;
}

export type Tx = pg.PoolClient;

/** Run `fn` in a transaction that is always rolled back (tests never leave data behind). */
export async function tx<T>(fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await db().connect();
  try {
    await c.query("BEGIN");
    return await fn(c);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

/** Run `fn` inside a savepoint; the savepoint is rolled back when `fn` throws, and the error is returned. */
export async function attempt(c: Tx, fn: () => Promise<unknown>): Promise<Error | null> {
  await c.query("SAVEPOINT attempt");
  try {
    await fn();
    await c.query("RELEASE SAVEPOINT attempt");
    return null;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT attempt");
    return e instanceof Error ? e : new Error(String(e));
  }
}

export interface Actor {
  readonly userId: string;
  readonly orgId: string;
}

/** Claims as the API sets them; optionally switch to the API role so RLS and grants apply. */
export async function actAs(c: Tx, actor: Actor | null, opts: { readonly apiRole?: boolean } = {}): Promise<void> {
  await c.query("RESET ROLE");
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [actor === null ? "" : JSON.stringify({ sub: actor.userId, org_id: actor.orgId })]);
  if (opts.apiRole === true) await c.query("SET LOCAL ROLE design_os_api");
}

const columnTypes = new Map<string, Map<string, string>>();
async function typesOf(c: Tx, table: string): Promise<Map<string, string>> {
  const cached = columnTypes.get(table);
  if (cached !== undefined) return cached;
  const r = await c.query<{ column_name: string; data_type: string }>(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'design_os' AND table_name = $1", [table]);
  const m = new Map(r.rows.map((x) => [x.column_name, x.data_type]));
  columnTypes.set(table, m);
  return m;
}

/** Insert a row object whose keys are column names (persistence row types). Keys that are not columns are an error. */
export async function insertRow(c: Tx, table: string, rowObject: object): Promise<void> {
  const row = rowObject as Readonly<Record<string, unknown>>;
  const types = await typesOf(c, table);
  const keys = Object.keys(row);
  for (const k of keys) if (!types.has(k)) throw new Error(`design_os.${table} has no column ${k}`);
  const values = keys.map((k) => {
    const v = row[k];
    return types.get(k) === "jsonb" && v !== null && v !== undefined ? JSON.stringify(v) : v;
  });
  await c.query(`INSERT INTO design_os.${table} (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, values);
}

export async function one<T extends pg.QueryResultRow>(c: Tx, sql: string, params: readonly unknown[] = []): Promise<T> {
  const r = await c.query<T>(sql, params as unknown[]);
  const row = r.rows[0];
  if (row === undefined) throw new Error(`no row: ${sql}`);
  return row;
}
