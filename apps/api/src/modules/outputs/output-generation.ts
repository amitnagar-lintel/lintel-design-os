import { randomUUID } from "node:crypto";
import { BoqGenerationError } from "@lintel/boq-engine";
import type { DependencyHashes, OutputPurpose, SnapshotProvenance, SnapshotRow, SnapshotSources } from "@lintel/persistence";
import {
  MappingError, buildSnapshotProvenance, buildSnapshotRecord, buildValidationRun, engineeringDependencyHashes, outputPurposeProblems, provenanceIdentity,
  recordValidationRunArgs, snapshotToRow,
} from "@lintel/persistence";
import type { ValidationMessage } from "@lintel/types";
import { stableStringify } from "@lintel/types";
import type { PermissionAction } from "../../common/auth/permissions.js";
import type { Tx } from "../../common/db/tx.js";
import { ApiProblem } from "../../common/errors/api-problem.js";
import type { ProblemCode } from "../../common/errors/problem-codes.js";
import { designVersionsRepository } from "../../infrastructure/persistence/design-versions.repository.js";
import type { SnapshotTable } from "../../infrastructure/persistence/outputs.repository.js";
import { outputsRepository } from "../../infrastructure/persistence/outputs.repository.js";
import { roomBom } from "./engines/bom.js";
import { roomBoq } from "./engines/boq.js";
import { roomPricing } from "./engines/pricing.js";
import { roomQuotation } from "./engines/quotation.js";
import type { OutputExecutionContext, OutputKind } from "./output-context.js";
import type { PayloadOf } from "./payloads.js";
import { StoredPayloadError, parseStoredPayload, storedPayloadProblem } from "./payloads.js";

export const SNAPSHOT_TABLE: Readonly<Record<OutputKind, SnapshotTable>> = { BOM: "bom_snapshot", BOQ: "boq_snapshot", PRICING: "pricing_snapshot", QUOTATION: "quotation_snapshot" };
/** Output permission matrix (Step 6 plan §14); the snapshot RLS policies enforce the same actions. */
export const GENERATE_ACTION: Readonly<Record<OutputKind, PermissionAction>> = {
  BOM: "output.generate.engineering", BOQ: "output.generate.engineering", PRICING: "output.generate.commercial", QUOTATION: "output.generate.commercial",
};
export const READ_ACTION: Readonly<Record<OutputKind, PermissionAction>> = {
  BOM: "output.read.production", BOQ: "output.read.production", PRICING: "output.read.cost", QUOTATION: "output.read.cost",
};
export const SOURCE_KIND: Readonly<Record<keyof SnapshotSources, OutputKind>> = { bomSnapshotId: "BOM", boqSnapshotId: "BOQ", pricingSnapshotId: "PRICING" };
export const SOURCE_COLUMN: Readonly<Record<keyof SnapshotSources, "bom_snapshot_id" | "boq_snapshot_id" | "pricing_snapshot_id">> = {
  bomSnapshotId: "bom_snapshot_id", boqSnapshotId: "boq_snapshot_id", pricingSnapshotId: "pricing_snapshot_id",
};
const RANK: Readonly<Record<OutputPurpose, number>> = { PRELIMINARY: 0, FOR_REVIEW: 1, FOR_PRODUCTION: 2 };

/**
 * One output used or produced by a request: the stored row and its payload as a VALIDATED domain object
 * (parseStoredPayload: Zod schema + content hash + engine seal) — the only form in which it reaches another engine.
 */
export type Produced = { readonly [K in OutputKind]: {
  readonly kind: K;
  readonly row: SnapshotRow;
  readonly payload: PayloadOf[K];
  /** Inserted by this request (false: an existing snapshot was reused or named). */
  readonly created: boolean;
} }[OutputKind];

export type Outcome =
  | { readonly status: "AVAILABLE"; readonly snapshot: Produced; readonly upstream: readonly Produced[] }
  | { readonly status: "UNAVAILABLE"; readonly kind: OutputKind; readonly blockers: readonly ValidationMessage[]; readonly upstream: readonly Produced[] };

/** Control flow only: the engine could not produce the output (returned to the caller, never persisted). */
class Unavailable extends Error {
  constructor(readonly kind: OutputKind, readonly blockers: readonly ValidationMessage[]) {
    super(`${kind} UNAVAILABLE`);
  }
}

/** The API code of a purpose / lifecycle refusal, before anything is read or recorded (plan §11). */
export function assertPurposeAllowed(kind: OutputKind, purpose: OutputPurpose, status: Parameters<typeof outputPurposeProblems>[2]): void {
  const [first] = outputPurposeProblems(kind, purpose, status, 0);
  if (first !== undefined) throw new ApiProblem(first.code, first.message);
}

/** Engine refusals that mean "the upstream snapshot is not for this room model" rather than "not available". */
const INCOMPATIBLE_CODES = new Set(["PRICING_TRACE_MISMATCH", "QUOTATION_TRACE_MISMATCH", "QUOTATION_PRICING_INVALID", "QUOTATION_CLASSIFICATION_MISMATCH"]);

const PENDING_RUN = "00000000-0000-0000-0000-000000000000";
const count = (messages: readonly ValidationMessage[], severity: string) => messages.filter((m) => m.severity === severity).length;
const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

/**
 * Server-orchestrated generation from ONE execution context (plan §7.2): the requested output and every missing
 * upstream output (BOM → BOQ → Pricing → Quotation) are found by exact natural identity or produced from the same
 * `ctx.resolved`, each consuming the exact stored upstream snapshot. The OUTPUT_GENERATION validation run of the
 * context is recorded lazily, only when the first snapshot is inserted, so a request that inserts nothing records
 * nothing. Nothing is ever overwritten; the caller's unit of work commits the run and the snapshots together.
 */
export class OutputGeneration {
  private runId: string | null = null;
  private readonly done = new Map<OutputKind, Produced>();
  private readonly permitted = new Map<PermissionAction, boolean>();

  constructor(
    private readonly tx: Tx,
    private readonly ctx: OutputExecutionContext,
    private readonly purpose: OutputPurpose,
    /** Exact upstream snapshots named for reproduction (plan §7.3); everything else is resolved by the server. */
    private readonly named: SnapshotSources = {},
  ) {}

  async generate(kind: OutputKind): Promise<Outcome> {
    try {
      const snapshot = await this.ensure(kind);
      return { status: "AVAILABLE", snapshot, upstream: this.upstreamOf(kind) };
    } catch (e) {
      if (e instanceof Unavailable) return { status: "UNAVAILABLE", kind: e.kind, blockers: e.blockers, upstream: this.upstreamOf(kind) };
      throw e;
    }
  }

  private upstreamOf(kind: OutputKind): Produced[] {
    return [...this.done.values()].filter((p) => p.kind !== kind);
  }

  /* ------------------------------------------------------------ resolution */

  private async ensure(kind: OutputKind): Promise<Produced> {
    const memo = this.done.get(kind);
    if (memo !== undefined) return memo;
    await this.require(READ_ACTION[kind], `using ${kind} snapshots`);
    const up = await this.upstream(kind);
    const lookup = this.provenance(kind, up.sources, PENDING_RUN);
    const existing = await outputsRepository.findByIdentity(this.tx, SNAPSHOT_TABLE[kind], provenanceIdentity({ kind, orgId: this.ctx.orgId, purpose: this.purpose, provenance: lookup }));
    if (existing !== null) return this.remember(existing as unknown as SnapshotRow, false);

    await this.require(GENERATE_ACTION[kind], `creating the missing ${kind} snapshot`);
    const produced = await this.produce(kind, up);
    const runId = await this.ensureRun();
    let record;
    try {
      record = buildSnapshotRecord({
        snapshotId: randomUUID(), kind, purpose: this.purpose, provenance: this.provenance(kind, up.sources, runId), payload: produced.payload,
        blockerCount: produced.blockerCount, warningCount: produced.warningCount, outputComplete: produced.outputComplete,
        validationBlockerCount: this.ctx.resolved.validation.counts.BLOCKER, createdBy: this.ctx.actorId, createdAt: this.ctx.createdAt,
        ...(produced.revisionNumber === undefined ? {} : { revisionNumber: produced.revisionNumber }),
      });
    } catch (e) {
      throw e instanceof MappingError ? refusal(e) : e;
    }
    const row = snapshotToRow(record, { orgId: this.ctx.orgId });
    if ((await outputsRepository.insert(this.tx, SNAPSHOT_TABLE[kind], row as unknown as Readonly<Record<string, unknown>>)) === "identity_conflict") {
      throw new ApiProblem("CONCURRENT_MODIFICATION", `a concurrent request generated the same ${kind} output; retry to reuse it`);
    }
    return this.remember(row, true);
  }

  /** Every stored or new snapshot is validated (schema, content hash, engine seal) before anything consumes it. */
  private remember(row: SnapshotRow, created: boolean): Produced {
    const p = producedFrom(row, created);
    this.done.set(p.kind, p);
    return p;
  }

  /** The exact upstream snapshots of a kind (named, linked from a named one, reused or generated), consistent with each other. */
  private async upstream(kind: OutputKind): Promise<{ readonly sources: SnapshotSources; readonly bom?: Produced; readonly boq?: Produced; readonly pricing?: Produced }> {
    switch (kind) {
      case "BOM":
        return { sources: {} };
      case "BOQ": {
        const bom = await this.source("bomSnapshotId");
        return { sources: { bomSnapshotId: bom.row.id }, bom };
      }
      case "PRICING": {
        const boq = await this.source("boqSnapshotId");
        const bom = await this.linked("bomSnapshotId", boq.row.bom_snapshot_id, boq);
        return { sources: { bomSnapshotId: bom.row.id, boqSnapshotId: boq.row.id }, bom, boq };
      }
      case "QUOTATION": {
        const pricing = await this.source("pricingSnapshotId");
        const boq = await this.linked("boqSnapshotId", pricing.row.boq_snapshot_id, pricing);
        return { sources: { boqSnapshotId: boq.row.id, pricingSnapshotId: pricing.row.id }, boq, pricing };
      }
    }
  }

  private source(key: keyof SnapshotSources): Promise<Produced> {
    const id = this.named[key];
    return id === undefined ? this.ensure(SOURCE_KIND[key]) : this.namedSource(key, id);
  }

  /** The upstream snapshot an upstream snapshot itself consumed: it must be the one used (or named) here too. */
  private async linked(key: keyof SnapshotSources, id: string | undefined, via: Produced): Promise<Produced> {
    if (id === undefined) throw new ApiProblem("INTERNAL", `${via.kind} snapshot ${via.row.id} has no ${key}`);
    const named = this.named[key];
    const have = this.done.get(SOURCE_KIND[key]);
    if ((named !== undefined && named !== id) || (have !== undefined && have.row.id !== id)) {
      throw new ApiProblem("SOURCE_SNAPSHOT_INCOMPATIBLE", `${key} must be the ${SOURCE_KIND[key]} snapshot the ${via.kind} snapshot ${via.row.id} consumed (${id})`, { context: { source: key } });
    }
    return have ?? this.namedSource(key, id);
  }

  /**
   * A named (or linked) upstream snapshot (plan §7.3): same design version and organization, exactly the current
   * engineering inputs and dependency content (and, for Pricing, the chosen PricingStandard), a purpose at least as
   * strong, and a verified payload. Its engine fingerprint may be older (reproduction; reported as SOURCE_STALE).
   */
  private async namedSource(key: keyof SnapshotSources, id: string): Promise<Produced> {
    const kind = SOURCE_KIND[key];
    await this.require(READ_ACTION[kind], `using ${kind} snapshots`);
    const row = (await outputsRepository.get(this.tx, SNAPSHOT_TABLE[kind], id)) as unknown as SnapshotRow | null;
    if (row === null) throw new ApiProblem("INVALID_REFERENCE", `${key} is not a ${kind} snapshot of this organization`, { errors: [{ path: `body.sources.${key}`, code: "not_found", message: "no such snapshot" }] });
    const incompatible = (why: string) => new ApiProblem("SOURCE_SNAPSHOT_INCOMPATIBLE", `${key} ${id}: ${why}`, { context: { source: key } });
    if (row.design_version_id !== this.ctx.version.id) throw incompatible("is an output of another design version");
    if (row.input_hash !== this.ctx.ref.inputHash || row.input_revision !== this.ctx.ref.inputRevision) throw incompatible("was generated from other engineering inputs");
    if (!same(engineeringDependencyHashes(row.dependency_hashes), this.ctx.engineering.dependencyHashes)) throw incompatible("was generated from other dependency content");
    if (kind === "PRICING" && (row.pricing_standard_version_id !== this.ctx.commercial.chosen.pricingStandardVersionId
      || row.dependency_hashes.pricing_standard_version_id !== this.ctx.commercial.dependencyHashes.pricing_standard_version_id)) {
      throw incompatible("was priced with another PricingStandard version or content");
    }
    if (RANK[row.purpose] < RANK[this.purpose]) {
      throw new ApiProblem("SOURCE_PURPOSE_INSUFFICIENT", `${key} is ${row.purpose}, weaker than ${this.purpose}`, { context: { source: key, sourcePurpose: row.purpose, purpose: this.purpose } });
    }
    return this.remember(row, false);
  }

  /* ------------------------------------------------------------ production */

  private provenance(kind: OutputKind, sources: SnapshotSources, validationRunId: string): SnapshotProvenance {
    const { chosen } = this.ctx.commercial;
    const used = {
      pricingStandardVersionId: kind === "PRICING" || kind === "QUOTATION" ? chosen.pricingStandardVersionId : null,
      quotationPolicyVersionId: kind === "QUOTATION" ? chosen.quotationPolicyVersionId : null,
      manufacturingStandardVersionId: null,
    };
    const commercial: DependencyHashes = {
      ...(used.pricingStandardVersionId === null ? {} : { pricing_standard_version_id: this.ctx.commercial.dependencyHashes.pricing_standard_version_id }),
      ...(used.quotationPolicyVersionId === null ? {} : { quotation_policy_version_id: this.ctx.commercial.dependencyHashes.quotation_policy_version_id }),
    };
    try {
      return buildSnapshotProvenance(kind, {
        designVersion: this.ctx.ref, pins: this.ctx.pins, chosen: used, dependencyHashes: { ...this.ctx.engineering.dependencyHashes, ...commercial },
        validationRunId, engine: this.ctx.engines[ENGINE[kind]], sources,
      });
    } catch (e) {
      if (e instanceof MappingError) throw new ApiProblem("VALIDATION_FAILED", e.message);
      throw e;
    }
  }

  /** Run the kind's output engine on the context's resolved room and the exact upstream payloads. */
  private async produce(kind: OutputKind, up: { readonly bom?: Produced; readonly boq?: Produced; readonly pricing?: Produced }): Promise<{
    readonly payload: unknown; readonly blockerCount: number; readonly warningCount: number; readonly outputComplete: boolean; readonly revisionNumber?: number;
  }> {
    const { resolved, catalog, createdAt } = this.ctx;
    const validation = resolved.validation.counts;
    const counted = (messages: readonly ValidationMessage[]) => ({ blockerCount: validation.BLOCKER + count(messages, "BLOCKER"), warningCount: validation.WARNING + count(messages, "WARNING") });
    const missing = () => new ApiProblem("INTERNAL", `missing upstream for ${kind}`);
    const bomOf = () => { if (up.bom?.kind !== "BOM") throw missing(); return up.bom.payload; };
    const boqOf = () => { if (up.boq?.kind !== "BOQ") throw missing(); return up.boq.payload; };
    const pricingOf = () => { if (up.pricing?.kind !== "PRICING") throw missing(); return up.pricing.payload; };
    switch (kind) {
      case "BOM": {
        const bom = roomBom(resolved);
        if (this.purpose === "FOR_PRODUCTION" && bom.incomplete) throw new ApiProblem("PRODUCTION_GUARD_FAILED", "FOR_PRODUCTION requires a complete BOM (unresolved hardware or missing components)");
        return { payload: bom, ...counted([]), outputComplete: !bom.incomplete };
      }
      case "BOQ": {
        try {
          return { payload: roomBoq(resolved, catalog, bomOf()), ...counted([]), outputComplete: true };
        } catch (e) {
          if (e instanceof BoqGenerationError) throw new ApiProblem("SOURCE_SNAPSHOT_INCOMPATIBLE", e.message, { context: { source: "bomSnapshotId" } });
          throw e;
        }
      }
      case "PRICING": {
        const pricingStandard = this.ctx.commercial.pricingStandard;
        if (pricingStandard === null) throw new ApiProblem("INTERNAL", "pricing requires a chosen PricingStandard version");
        const r = roomPricing({ resolved, bom: bomOf(), boq: boqOf(), pricingStandard, createdAt });
        if (r.status === "UNAVAILABLE") throw this.unavailable(kind, r.blockers, "boqSnapshotId");
        return { payload: r.snapshot, ...counted(r.messages), outputComplete: true };
      }
      case "QUOTATION": {
        const quotationPolicy = this.ctx.commercial.quotationPolicy;
        if (quotationPolicy === null) throw new ApiProblem("INTERNAL", "a quotation requires a chosen QuotationPolicy version");
        const revisionNumber = await outputsRepository.nextQuotationRevision(this.tx, this.ctx.version.id);
        const r = roomQuotation({
          resolved, catalog, boq: boqOf(), pricing: pricingOf(), quotationPolicy, revision: String(revisionNumber), createdAt,
        });
        if (r.status === "UNAVAILABLE") throw this.unavailable(kind, r.blockers, "pricingSnapshotId");
        return { payload: r.snapshot, ...counted(r.messages), outputComplete: true, revisionNumber };
      }
    }
  }

  /** UNAVAILABLE is returned, never persisted (OD-S6-5) — unless the engine says the upstream is for another room model. */
  private unavailable(kind: OutputKind, blockers: readonly ValidationMessage[], source: keyof SnapshotSources): ApiProblem | Unavailable {
    const mismatch = blockers.filter((b) => INCOMPATIBLE_CODES.has(b.code));
    if (mismatch.length > 0) return new ApiProblem("SOURCE_SNAPSHOT_INCOMPATIBLE", mismatch.map((b) => b.message).join("; "), { context: { source } });
    return new Unavailable(kind, blockers);
  }

  /**
   * The context's OUTPUT_GENERATION run: recorded (or reused by natural identity) from `ctx.resolved.validation` just
   * before the first snapshot insert of the request, so it is always referenced by a snapshot of the same transaction.
   */
  private async ensureRun(): Promise<string> {
    if (this.runId !== null) return this.runId;
    const run = buildValidationRun({ purpose: "OUTPUT_GENERATION", designVersionId: this.ctx.version.id, inputHash: this.ctx.ref.inputHash, engine: this.ctx.engines.validation, validation: this.ctx.resolved.validation });
    try {
      this.runId = await designVersionsRepository.recordRun(this.tx, recordValidationRunArgs(run));
    } catch (e) {
      const err = e as { code?: string; constraint?: string };
      if (err.code === "23505" && err.constraint === "validation_run_output_identity") throw new ApiProblem("CONCURRENT_MODIFICATION", "a concurrent request recorded the same validation run; retry");
      throw e;
    }
    return this.runId;
  }

  /** Orchestration never escalates (plan §14): each upstream step needs the caller's own action. */
  private async require(action: PermissionAction, what: string): Promise<void> {
    let ok = this.permitted.get(action);
    if (ok === undefined) {
      ok = await outputsRepository.hasPermission(this.tx, action);
      this.permitted.set(action, ok);
    }
    if (!ok) throw new ApiProblem("PERMISSION_DENIED", `${what} requires ${action}`, { context: { requiredAction: action } });
  }
}

/** A stored row as a Produced output; a payload failing its checks never reaches an engine. */
export function producedFrom(row: SnapshotRow, created: boolean): Produced {
  try {
    switch (row.kind) {
      case "BOM": return { kind: "BOM", row, created, payload: parseStoredPayload("BOM", row) };
      case "BOQ": return { kind: "BOQ", row, created, payload: parseStoredPayload("BOQ", row) };
      case "PRICING": return { kind: "PRICING", row, created, payload: parseStoredPayload("PRICING", row) };
      case "QUOTATION": return { kind: "QUOTATION", row, created, payload: parseStoredPayload("QUOTATION", row) };
      case "DRAWING":
      case "MANUFACTURING_DOCUMENT":
        throw new ApiProblem("INTERNAL", `${row.kind} snapshots are not generated here`);
    }
  } catch (e) {
    throw e instanceof StoredPayloadError ? storedPayloadProblem(e) : e;
  }
}

const ENGINE = { BOM: "bom", BOQ: "boq", PRICING: "pricing", QUOTATION: "quotation" } as const satisfies Record<OutputKind, string>;

/** A record refused by @lintel/persistence (a guard the pre-checks did not catch) as its API code. */
function refusal(e: MappingError): ApiProblem {
  const code = (["VALIDATION_BLOCKERS", "PRODUCTION_GUARD_FAILED", "OUTPUT_PURPOSE_NOT_ALLOWED"] as const).find((c) => e.message.includes(`${c}:`));
  return new ApiProblem((code ?? "INTERNAL") satisfies ProblemCode, e.message);
}
