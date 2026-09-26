import { SetMetadata } from "@nestjs/common";
import type { z } from "zod";

/**
 * OpenAPI route metadata (Step 6 plan §17): explicit, next to the route. Request schemas are NOT repeated here — the
 * generator reads them from the route's SchemaPipes (the same Zod schemas that validate requests). A route declares
 * its success responses (status → Zod schema, or "binary" for raw file bytes) and its HTTP preconditions.
 */
export const OPENAPI = "lintel:openapi";

export interface ApiDocSpec {
  readonly summary: string;
  readonly responses: Readonly<Record<number, z.ZodType | "binary">>;
  /** The route requires an Idempotency-Key header. */
  readonly idempotent?: true;
  /** If-Match: required for writes guarded by an ETag; optional where a stale ETag is refused but none is required. */
  readonly ifMatch?: "required" | "optional";
}

export const ApiDoc = (spec: ApiDocSpec) => SetMetadata(OPENAPI, spec);
