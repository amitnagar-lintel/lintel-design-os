import { Inject, Injectable } from "@nestjs/common";
import type { Principal, RequestScope } from "../../common/auth/context.js";
import { OrgContextResolver } from "../../common/auth/org-context.js";
import type { MeResponse, MyOrganizationsResponse } from "./me.schemas.js";

@Injectable()
export class MeService {
  constructor(@Inject(OrgContextResolver) private readonly orgs: OrgContextResolver) {}

  me(scope: RequestScope): MeResponse {
    return {
      userId: scope.principal.userId,
      orgId: scope.org.orgId,
      identityKind: scope.org.identityKind,
      // Code-point order in the API, so responses never depend on the database collation.
      roles: [...scope.org.roles].sort(),
      permissions: [...scope.org.permissions].sort(),
    };
  }

  async organizations(principal: Principal, requestId: string): Promise<MyOrganizationsResponse> {
    return { items: (await this.orgs.organizations(principal, requestId)).map((orgId) => ({ orgId })) };
  }
}
