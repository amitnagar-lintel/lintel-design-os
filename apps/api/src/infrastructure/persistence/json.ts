import type { Tx } from "../../common/db/tx.js";

/**
 * Read rows as JSON (`to_jsonb`): numerics arrive as exact JSON numbers, timestamps as stable ISO text, uuids as
 * strings and jsonb as objects — the shapes @lintel/persistence row types expect. Repositories use this for every
 * domain read, so hashing (input / content hashes) always sees the same representation.
 */
export async function jsonRows<R>(tx: Tx, innerSql: string, params: readonly unknown[] = []): Promise<R[]> {
  // A MATERIALIZED CTE accepts INSERT/UPDATE/DELETE … RETURNING as well as SELECT, and keeps the inner ORDER BY.
  return (await tx.query<{ r: R }>(`WITH x AS MATERIALIZED (${innerSql}) SELECT to_jsonb(x) AS r FROM x`, params)).map((row) => row.r);
}

export async function jsonRow<R>(tx: Tx, innerSql: string, params: readonly unknown[] = []): Promise<R | null> {
  const rows = await jsonRows<R>(tx, innerSql, params);
  if (rows.length > 1) throw new Error(`expected at most one row, got ${String(rows.length)}`);
  return rows[0] ?? null;
}

export interface Keyset {
  readonly where: string;
  readonly orderLimit: string;
}
