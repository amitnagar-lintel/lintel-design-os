import type { ExecutionContext } from "@nestjs/common";
import { createParamDecorator, SetMetadata } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ApiProblem } from "../errors/api-problem.js";
import type { RequestScope } from "./context.js";
import type { PermissionAction } from "./permissions.js";

/**
 * Route access declarations. The access guard FAILS CLOSED: every route must declare exactly one of
 * @Public(), @RequiresAction(action) or @AuthenticatedOnly(); an undeclared route is refused.
 */
export const ACCESS = "lintel:access";
export type AccessDeclaration = { readonly kind: "public" } | { readonly kind: "action"; readonly actions: readonly PermissionAction[] } | { readonly kind: "authenticated" };
export const Public = () => SetMetadata(ACCESS, { kind: "public" } satisfies AccessDeclaration);
/** The caller needs the action (or, with several, ANY of them — exactly as the database function or RLS policy behind the route). */
export const RequiresAction = (action: PermissionAction, ...alternatives: PermissionAction[]) =>
  SetMetadata(ACCESS, { kind: "action", actions: [action, ...alternatives] } satisfies AccessDeclaration);
/** Any authenticated member of the selected org; no specific action (e.g. GET /me). */
export const AuthenticatedOnly = () => SetMetadata(ACCESS, { kind: "authenticated" } satisfies AccessDeclaration);

/** Route family: INTERNAL (default), CLIENT (the portal) or ANY. */
export const IDENTITY = "lintel:identity";
export type IdentityRequirement = "INTERNAL" | "CLIENT" | "ANY";
export const ClientRoute = () => SetMetadata(IDENTITY, "CLIENT" satisfies IdentityRequirement);
export const AnyIdentity = () => SetMetadata(IDENTITY, "ANY" satisfies IdentityRequirement);

/** Authenticated, but no organization context (e.g. listing the caller's own memberships to choose one). */
export const NO_ORG = "lintel:no-org";
export const NoOrgContext = () => SetMetadata(NO_ORG, true);

/** The verified request scope (identity + org context + request id) for application services. */
export const Scope = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestScope => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  if (req.lintelPrincipal === undefined || req.lintelOrg === undefined) throw new ApiProblem("INTERNAL");
  return { requestId: req.id, principal: req.lintelPrincipal, org: req.lintelOrg };
});
