import type pg from "pg";

/** The narrow query surface repositories and services get inside a unit of work. */
export interface Tx {
  query<R extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R[]>;
  one<R extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R>;
  maybeOne<R extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R | null>;
}

export function wrap(client: pg.PoolClient): Tx {
  const query = async <R extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<R[]> =>
    (await client.query<R>(sql, params as unknown[])).rows;
  return {
    query,
    async one<R extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<R> {
      const rows = await query<R>(sql, params);
      const row = rows[0];
      if (rows.length !== 1 || row === undefined) throw new Error(`expected exactly one row, got ${String(rows.length)}`);
      return row;
    },
    async maybeOne<R extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<R | null> {
      const rows = await query<R>(sql, params);
      if (rows.length > 1) throw new Error(`expected at most one row, got ${String(rows.length)}`);
      return rows[0] ?? null;
    },
  };
}
