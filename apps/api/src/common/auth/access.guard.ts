import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { ApiProblem } from "../errors/api-problem.js";
import type { AccessDeclaration, IdentityRequirement } from "./decorators.js";
import { ACCESS, IDENTITY, NO_ORG } from "./decorators.js";
import { JwtVerifier } from "./jwt.js";
import { OrgContextResolver } from "./org-context.js";

/**
 * The single global guard, in order: route declaration (fail closed) → authentication → verified org context →
 * identity kind → action permission. It runs before any application service touches the database; RLS and the
 * definer functions re-check everything as the final boundary.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtVerifier) private readonly jwt: JwtVerifier,
    @Inject(OrgContextResolver) private readonly orgs: OrgContextResolver,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const access = this.reflector.getAllAndOverride<AccessDeclaration | undefined>(ACCESS, targets);
    if (access === undefined) throw new ApiProblem("INTERNAL", "route has no access declaration");
    if (access.kind === "public") return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    req.lintelPrincipal = await this.jwt.verify(req.headers.authorization);
    if (this.reflector.getAllAndOverride<boolean | undefined>(NO_ORG, targets) === true) {
      if (access.kind === "action") throw new ApiProblem("INTERNAL", "an action check needs an org context");
      return true;
    }

    const xOrg = req.headers["x-org"];
    if (Array.isArray(xOrg)) throw new ApiProblem("VALIDATION_FAILED", undefined, { errors: [{ path: "headers.x-org", code: "invalid", message: "only one X-Org header is allowed" }] });
    const org = await this.orgs.resolve(req.lintelPrincipal, xOrg, req.id);
    req.lintelOrg = org;

    const identity = this.reflector.getAllAndOverride<IdentityRequirement | undefined>(IDENTITY, targets) ?? "INTERNAL";
    if (identity !== "ANY" && identity !== org.identityKind) throw new ApiProblem("IDENTITY_KIND_MISMATCH");
    if (access.kind === "action" && !org.permissions.has(access.action)) throw new ApiProblem("PERMISSION_DENIED");
    return true;
  }
}
