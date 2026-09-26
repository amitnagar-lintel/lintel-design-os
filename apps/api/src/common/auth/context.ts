import type { PermissionAction } from "./permissions.js";

/** The verified identity from the access token. */
export interface Principal {
  readonly userId: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
}

/** An organization context established ONLY after verifying the identity's ACTIVE membership (§2.1). */
export interface OrgContext {
  readonly orgId: string;
  readonly identityKind: "INTERNAL" | "CLIENT";
  readonly roles: readonly string[];
  readonly permissions: ReadonlySet<PermissionAction>;
}

/** What an application service receives for a request. */
export interface RequestScope {
  readonly requestId: string;
  readonly principal: Principal;
  readonly org: OrgContext;
}

declare module "fastify" {
  interface FastifyRequest {
    lintelPrincipal?: Principal;
    lintelOrg?: OrgContext;
  }
}
