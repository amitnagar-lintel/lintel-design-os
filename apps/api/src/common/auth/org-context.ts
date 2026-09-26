import { Inject, Injectable } from "@nestjs/common";
import { accessRepository } from "../../infrastructure/persistence/access.repository.js";
import { Database } from "../db/database.js";
import { ApiProblem } from "../errors/api-problem.js";
import type { OrgContext, Principal } from "./context.js";
import type { PermissionAction } from "./permissions.js";
import { isPermissionAction } from "./permissions.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Authenticated identity → verified ACTIVE membership → authorized org context (§2.1). X-Org only SELECTS one of
 * the identity's own memberships; it never establishes access by itself. A non-member, a suspended or inactive org
 * and a non-existent org all get the same 403 ORG_ACCESS_DENIED.
 */
@Injectable()
export class OrgContextResolver {
  constructor(@Inject(Database) private readonly db: Database) {}

  /** The caller's own ACTIVE memberships (org ids only). */
  organizations(principal: Principal, requestId: string): Promise<string[]> {
    return this.db.transaction({ claims: { sub: principal.userId }, requestId, readOnly: true }, (tx) => accessRepository.memberships(tx));
  }

  async resolve(principal: Principal, xOrg: string | undefined, requestId: string): Promise<OrgContext> {
    if (xOrg !== undefined && !UUID.test(xOrg)) {
      throw new ApiProblem("VALIDATION_FAILED", undefined, { errors: [{ path: "headers.x-org", code: "invalid", message: "must be a UUID" }] });
    }
    const orgs = await this.organizations(principal, requestId);
    let orgId: string;
    if (xOrg !== undefined) {
      const wanted = xOrg.toLowerCase();
      if (!orgs.includes(wanted)) throw new ApiProblem("ORG_ACCESS_DENIED");
      orgId = wanted;
    } else if (orgs.length === 1 && orgs[0] !== undefined) {
      orgId = orgs[0];
    } else if (orgs.length === 0) {
      throw new ApiProblem("ORG_ACCESS_DENIED");
    } else {
      throw new ApiProblem("ORG_SELECTION_REQUIRED");
    }
    // Establish the org context only now, for the verified org, and let the database confirm it.
    const row = await this.db.transaction({ claims: { sub: principal.userId, org_id: orgId }, requestId, readOnly: true }, (tx) => accessRepository.orgContext(tx));
    if (row.org_id !== orgId || row.internal === null) throw new ApiProblem("ORG_ACCESS_DENIED");
    return {
      orgId,
      identityKind: row.internal ? "INTERNAL" : "CLIENT",
      roles: row.roles,
      permissions: new Set(row.permissions.filter(isPermissionAction) satisfies PermissionAction[]),
    };
  }
}
