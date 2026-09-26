import type { OnApplicationShutdown } from "@nestjs/common";
import { Inject, Injectable } from "@nestjs/common";
import pg from "pg";
import { PG_POOL } from "../tokens.js";

/**
 * The API's connection pool. It logs in with a deployment login role whose only privilege is membership in the
 * NOLOGIN role design_os_api; every transaction runs `SET LOCAL ROLE design_os_api`, so RLS always applies.
 * Timestamps, bigints and numerics are returned as text (never Date / float) so hashes and cursors are exact; the
 * session time zone is UTC.
 */
const RAW = new Set<number>([pg.types.builtins.INT8, pg.types.builtins.NUMERIC, pg.types.builtins.TIMESTAMPTZ, pg.types.builtins.TIMESTAMP, pg.types.builtins.DATE]);

export function createPool(connectionString: string, max: number): pg.Pool {
  return new pg.Pool({
    connectionString,
    max,
    options: "-c TimeZone=UTC -c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000",
    types: {
      getTypeParser: ((oid: number, format?: string): ((v: string) => unknown) =>
        RAW.has(oid) ? (v: string) => v : (pg.types.getTypeParser(oid, format as "text") as (v: string) => unknown)) as typeof pg.types.getTypeParser,
    },
  });
}

/** Closes the pool when the application shuts down. */
@Injectable()
export class PoolLifecycle implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
