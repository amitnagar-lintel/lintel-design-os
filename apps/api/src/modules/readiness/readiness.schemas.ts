import { z } from "zod";
import { PageQuery, Uuid } from "../../common/http/schemas.js";

/** GET /ready (public): minimal, for load balancers and deploy automation. No versions, no details, no secrets. */
export const ReadyResponse = z.strictObject({
  status: z.enum(["ready", "not_ready"]),
  checks: z.strictObject({ database: z.enum(["pass", "fail"]), migrations: z.enum(["pass", "fail"]), engineManifest: z.enum(["pass", "fail"]) }),
});
export type ReadyResponse = z.infer<typeof ReadyResponse>;

export const CheckLevel = z.enum(["BLOCKING", "WARNING", "INFO"]);
export const CheckStatus = z.enum(["PASS", "FAIL", "SKIPPED"]);
export const ReadinessCheck = z.strictObject({
  id: z.string(),
  level: CheckLevel,
  status: CheckStatus,
  message: z.string(),
  details: z.record(z.string(), z.unknown()),
});
export type ReadinessCheck = z.infer<typeof ReadinessCheck>;

/** GET /readiness (audit.read): the deterministic gate report of the build, the database and the organization's data. */
export const ReadinessReport = z.strictObject({
  /** READY when no BLOCKING check fails. WARNING failures never block; INFO is informational. */
  status: z.enum(["READY", "NOT_READY"]),
  build: z.strictObject({ revision: z.string(), engines: z.record(z.string(), z.string()) }),
  summary: z.strictObject({ blockingFailures: z.number().int(), warnings: z.number().int(), checks: z.number().int() }),
  checks: z.array(ReadinessCheck),
});
export type ReadinessReport = z.infer<typeof ReadinessReport>;

export const AuditQuery = PageQuery.extend({
  table: z.string().trim().regex(/^[a-z_]{1,63}$/).optional(),
  rowId: z.string().trim().min(1).max(200).optional(),
  actorUserId: Uuid.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
}).strict();
export type AuditQuery = z.infer<typeof AuditQuery>;

export const AuditEntry = z.strictObject({
  id: z.number().int(),
  occurredAt: z.string(),
  actorUserId: Uuid.nullable(),
  action: z.enum(["INSERT", "UPDATE", "DELETE"]),
  table: z.string(),
  rowId: z.string().nullable(),
  oldValue: z.unknown(),
  newValue: z.unknown(),
  reason: z.string().nullable(),
  requestId: z.string().nullable(),
  prevHash: z.string().nullable(),
  rowHash: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const AuditChainResponse = z.strictObject({ ok: z.boolean(), checked: z.number().int(), firstBadId: z.number().int().nullable() });
export type AuditChainResponse = z.infer<typeof AuditChainResponse>;
