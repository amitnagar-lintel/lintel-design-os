/**
 * Request rate limiting (M6 CP3). Two layers, every limit from the environment (RATE_LIMIT_*):
 *  1. per client IP, before authentication, on every request (protects sign-in / token probing, public routes and
 *     unauthenticated floods) — see createApp;
 *  2. per verified user AND organization, after the access guard, by route class:
 *       sensitive  onboarding, invitations, role changes, lifecycle transitions and issue (low limit);
 *       write      every other non-GET route;
 *       read       every other GET route.
 * Exceeding a limit is 429 RATE_LIMITED (RFC 9457) with Retry-After. The counters are in-process fixed windows: V1 runs
 * one API instance (OD-M6-1); with more instances each enforces its own share (a shared store is a later change).
 */
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import type { ApiConfig } from "../../config.js";
import type { AccessDeclaration } from "../auth/decorators.js";
import { ACCESS } from "../auth/decorators.js";
import { ApiProblem } from "../errors/api-problem.js";
import { API_CONFIG } from "../tokens.js";

export type RateClass = "read" | "write" | "sensitive";

export interface RateDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Whole seconds until the current window ends (≥ 1). */
  readonly retryAfterSeconds: number;
}

/** Fixed-window counters keyed by an opaque string. Deterministic given `now`. */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  hit(key: string, max: number, windowMs: number): RateDecision {
    const t = this.now();
    if (this.windows.size > 50_000) for (const [k, w] of this.windows) if (t - w.start >= windowMs) this.windows.delete(k);
    let w = this.windows.get(key);
    if (w === undefined || t - w.start >= windowMs) {
      w = { start: t, count: 0 };
      this.windows.set(key, w);
    }
    w.count++;
    return { allowed: w.count <= max, limit: max, remaining: Math.max(0, max - w.count), retryAfterSeconds: Math.max(1, Math.ceil((w.start + windowMs - t) / 1000)) };
  }
}

export function rateLimited(d: RateDecision): ApiProblem {
  return new ApiProblem("RATE_LIMITED", undefined, { headers: { "retry-after": String(d.retryAfterSeconds), "ratelimit-limit": String(d.limit), "ratelimit-remaining": "0" } });
}

const RATE_CLASS = "lintel:rate-class";
/** Marks a route (or controller) as sensitive; otherwise GET is `read` and everything else `write`. */
export const SensitiveRate = () => SetMetadata(RATE_CLASS, "sensitive" satisfies RateClass);

/** The per-user / per-organization layer. Runs after the access guard (the identity is verified by then). */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly limiter = new FixedWindowLimiter();
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(API_CONFIG) private readonly config: ApiConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const rl = this.config.rateLimit;
    if (!rl.enabled) return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    const access = this.reflector.getAllAndOverride<AccessDeclaration | undefined>(ACCESS, targets);
    if (access === undefined || access.kind === "public") return true; // public routes: the per-IP layer only
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const user = req.lintelPrincipal?.userId;
    if (user === undefined) return true;
    const cls = this.reflector.getAllAndOverride<RateClass | undefined>(RATE_CLASS, targets) ?? (req.method === "GET" || req.method === "HEAD" ? "read" : "write");
    const decision = this.limiter.hit(`${cls}:${req.lintelOrg?.orgId ?? "-"}:${user}`, rl[cls], rl.windowMs);
    if (!decision.allowed) throw rateLimited(decision);
    return true;
  }
}
