import { Inject, Injectable } from "@nestjs/common";
import type pg from "pg";
import { PG_POOL } from "../tokens.js";
import type { Tx } from "./tx.js";
import { wrap } from "./tx.js";

export interface TransactionOptions {
  /** The verified identity, and the org ONLY once membership has been verified (never a raw header value). */
  readonly claims: { readonly sub: string; readonly org_id?: string };
  readonly requestId: string;
  readonly reason?: string;
  readonly isolation?: "READ COMMITTED" | "REPEATABLE READ";
  readonly readOnly?: boolean;
}

/**
 * The only place a database transaction is opened. Every transaction runs as design_os_api (RLS applies) with
 * transaction-local claims, request id and reason, so nothing can leak to the next user of a pooled connection.
 */
@Injectable()
export class Database {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async transaction<T>(opts: TransactionOptions, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${opts.isolation ?? "READ COMMITTED"}${opts.readOnly === true ? " READ ONLY" : ""}`);
      await client.query("SET LOCAL ROLE design_os_api");
      await client.query(
        "SELECT set_config('request.jwt.claims', $1, true), set_config('design_os.request_id', $2, true), set_config('design_os.reason', $3, true)",
        [JSON.stringify(opts.claims), opts.requestId, opts.reason ?? ""],
      );
      const result = await fn(wrap(client));
      await client.query("COMMIT");
      return result;
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        broken = true;
      }
      throw e;
    } finally {
      client.release(broken);
    }
  }
}
