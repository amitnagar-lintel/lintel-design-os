import { z } from "zod";

/** Shared request/response schemas (M5 Step 4 plan §11.2). Every object schema is strict: unknown keys are rejected. */
export const Uuid = z.uuid();
export const Sha256Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/, "must be sha256: followed by 64 lowercase hex characters");
export const Reason = z.string().trim().min(1).max(2000);
export const LifecycleStatus = z.enum(["DRAFT", "IN_REVIEW", "APPROVED", "LOCKED", "SUPERSEDED"]);
export const TransitionAction = z.enum(["SUBMIT", "REQUEST_CHANGES", "APPROVE", "LOCK"]);
export const OutputPurpose = z.enum(["PRELIMINARY", "FOR_REVIEW", "FOR_PRODUCTION"]);
export const IdentityKind = z.enum(["INTERNAL", "CLIENT"]);

/** Idempotency-Key header value: 16–128 visible ASCII characters (clients send a UUID). Mirrors the database CHECK. */
export const IdempotencyKey = z.string().regex(/^[!-~]{16,128}$/, "must be 16-128 visible ASCII characters");

export const MAX_PAGE_SIZE = 200;
export const PageQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  cursor: z.string().min(1).max(1024).optional(),
});
export type PageQuery = z.infer<typeof PageQuery>;

export function Page<T extends z.ZodType>(item: T) {
  return z.strictObject({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const FieldErrorSchema = z.strictObject({ path: z.string(), code: z.string(), message: z.string() });
export const ProblemSchema = z.strictObject({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string(),
  code: z.string(),
  requestId: z.string(),
  errors: z.array(FieldErrorSchema).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});
