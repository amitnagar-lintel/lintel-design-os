import { Inject, Injectable } from "@nestjs/common";
import type { RequestScope } from "../auth/context.js";
import type { PermissionAction } from "../auth/permissions.js";
import { ApiProblem } from "../errors/api-problem.js";
import { Database } from "./database.js";
import type { Tx } from "./tx.js";

export interface UnitOfWorkOptions {
  readonly reason?: string;
  readonly isolation?: "READ COMMITTED" | "REPEATABLE READ";
  readonly readOnly?: boolean;
  /** Re-checked inside the transaction, so a permission revoked since the guard ran is honoured. */
  readonly action?: PermissionAction;
}

/**
 * One transaction per request operation, under the org context the access guard verified. It re-verifies that
 * context in-transaction (design_os.current_org_id() must still equal it; the action must still be granted)
 * before the operation runs; RLS then applies to every statement.
 */
@Injectable()
export class UnitOfWork {
  constructor(@Inject(Database) private readonly db: Database) {}

  run<T>(scope: RequestScope, opts: UnitOfWorkOptions, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(
      {
        claims: { sub: scope.principal.userId, org_id: scope.org.orgId },
        requestId: scope.requestId,
        ...(opts.reason === undefined ? {} : { reason: opts.reason }),
        ...(opts.isolation === undefined ? {} : { isolation: opts.isolation }),
        ...(opts.readOnly === undefined ? {} : { readOnly: opts.readOnly }),
      },
      async (tx) => {
        const check = await tx.one<{ org: string | null; allowed: boolean | null }>(
          "SELECT design_os.current_org_id()::text AS org, CASE WHEN $1::text IS NULL THEN NULL ELSE design_os.has_permission($1) END AS allowed",
          [opts.action ?? null],
        );
        if (check.org !== scope.org.orgId) throw new ApiProblem("ORG_ACCESS_DENIED");
        if (opts.action !== undefined && check.allowed !== true) throw new ApiProblem("PERMISSION_DENIED");
        return fn(tx);
      },
    );
  }
}
