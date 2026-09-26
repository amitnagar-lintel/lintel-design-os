import type { Tx } from "../db/tx.js";
import type { CursorCodec, SortSpec } from "./pagination.js";
import { keysetClause, toPage } from "./pagination.js";
import type { PageQuery } from "./schemas.js";

/**
 * One keyset page of a collection (application-service glue): decode the cursor for this collection + org + sort,
 * fetch `limit + 1` rows through the repository, and encode the next cursor.
 */
export async function keysetList<R, T>(tx: Tx, o: {
  readonly codec: CursorCodec;
  readonly collection: string;
  readonly orgId: string;
  readonly sort: SortSpec;
  readonly query: PageQuery;
  /** First free bind parameter after the repository's own parameters. */
  readonly firstParam: number;
  readonly fetch: (tx: Tx, page: { readonly where: string; readonly orderLimit: string }, params: readonly unknown[]) => Promise<R[]>;
  readonly key: (r: R) => unknown;
  readonly id: (r: R) => string;
  readonly map: (r: R) => T;
}): Promise<{ items: T[]; nextCursor: string | null }> {
  const after = o.query.cursor === undefined ? undefined : o.codec.decode(o.query.cursor, o.collection, o.orgId, o.sort);
  const page = keysetClause(o.sort, o.firstParam, after !== undefined);
  const params = after === undefined ? [o.query.limit + 1] : [after.key, after.id, o.query.limit + 1];
  const rows = await o.fetch(tx, page, params);
  return toPage(rows, o.query.limit, (r) => o.codec.encode(o.collection, o.orgId, o.sort, { key: o.key(r), id: o.id(r) }), o.map);
}
