import type { webcrypto } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { JWTVerifyGetKey } from "jose";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { ApiConfig } from "../../config.js";
import { ApiProblem } from "../errors/api-problem.js";
import { API_CONFIG } from "../tokens.js";
import type { Principal } from "./context.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verifies Supabase Auth access tokens: signature, issuer, audience, expiry, `role = authenticated` (never an
 * anon or service_role key) and a UUID `sub`. Anything else is 401 AUTH_REQUIRED, with no hint why.
 */
@Injectable()
export class JwtVerifier {
  private readonly key: Uint8Array | webcrypto.CryptoKey | JWTVerifyGetKey;
  private readonly algorithms: string[];

  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {
    const k = config.auth.key;
    if (k.kind === "jwks") {
      this.key = createRemoteJWKSet(k.url);
      this.algorithms = ["ES256", "RS256", "EdDSA"];
    } else if (k.kind === "secret") {
      this.key = k.secret;
      this.algorithms = ["HS256"];
    } else {
      this.key = k.key;
      this.algorithms = ["ES256", "RS256", "EdDSA"];
    }
  }

  async verify(authorization: string | undefined): Promise<Principal> {
    const m = /^Bearer ([A-Za-z0-9_\-.]+)$/.exec(authorization ?? "");
    const token = m?.[1];
    if (token === undefined) throw new ApiProblem("AUTH_REQUIRED");
    try {
      const options = {
        issuer: this.config.auth.issuer,
        audience: this.config.auth.audience,
        algorithms: this.algorithms,
        requiredClaims: ["sub", "exp"],
      };
      const { payload } = typeof this.key === "function" ? await jwtVerify(token, this.key, options) : await jwtVerify(token, this.key, options);
      if (typeof payload.sub !== "string" || !UUID.test(payload.sub) || payload.role !== "authenticated") throw new Error("claims");
      return {
        userId: payload.sub.toLowerCase(),
        email: typeof payload.email === "string" ? payload.email : null,
        emailVerified: payload.email_verified === true,
      };
    } catch {
      throw new ApiProblem("AUTH_REQUIRED");
    }
  }
}
