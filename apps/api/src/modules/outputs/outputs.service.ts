import { Inject, Injectable } from "@nestjs/common";
import type { EngineProvenance, OutputPurpose, SnapshotRow, SnapshotSources } from "@lintel/persistence";
import { qualifiesForIssue, qualifiesForRelease } from "@lintel/persistence";
import { compareRoomTrace } from "@lintel/design-engine";
import { checkQuotationStaleness } from "@lintel/pricing-engine";
import type { RequestScope } from "../../common/auth/context.js";
import type { Tx } from "../../common/db/tx.js";
import { UnitOfWork } from "../../common/db/unit-of-work.js";
import { ApiProblem } from "../../common/errors/api-problem.js";
import { iso } from "../../common/http/format.js";
import { keysetList } from "../../common/http/list.js";
import { CursorCodec, SORTS } from "../../common/http/pagination.js";
import type { IdempotentRequest } from "../../common/http/request.js";
import type { PageQuery } from "../../common/http/schemas.js";
import type { IdempotencyScope, StoredResponse } from "../../common/idempotency/idempotency.service.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import { API_CONFIG, ENGINE_MANIFEST } from "../../common/tokens.js";
import type { ApiConfig } from "../../config.js";
import type { EngineManifest } from "../../infrastructure/engines/engine-manifest.js";
import { designVersionsRepository } from "../../infrastructure/persistence/design-versions.repository.js";
import { outputsRepository } from "../../infrastructure/persistence/outputs.repository.js";
import { pinsOf } from "../design-versions/design-content.js";
import type { OutputEngine, OutputKind } from "./output-context.js";
import { buildOutputExecutionContext, outputEngines } from "./output-context.js";
import type { Produced } from "./output-generation.js";
import { OutputGeneration, READ_ACTION, GENERATE_ACTION, SNAPSHOT_TABLE, SOURCE_COLUMN, SOURCE_KIND, assertPurposeAllowed, producedFrom } from "./output-generation.js";
import type { GenerateRequest, Snapshot, SnapshotEnvelope } from "./outputs.schemas.js";
import { StalenessCalculator } from "./staleness.js";

const IDEMPOTENCY: Readonly<Record<OutputKind, IdempotencyScope>> = {
  BOM: "snapshot.bom.generate", BOQ: "snapshot.boq.generate", PRICING: "snapshot.pricing.generate", QUOTATION: "snapshot.quotation.generate",
};
export const KIND_PATH: Readonly<Record<OutputKind, string>> = { BOM: "bom-snapshots", BOQ: "boq-snapshots", PRICING: "pricing-snapshots", QUOTATION: "quotation-snapshots" };
const KIND_OF_TABLE = Object.fromEntries(Object.entries(SNAPSHOT_TABLE).map(([k, t]) => [t, k])) as Record<string, OutputKind>;

const summary = (row: SnapshotRow) => ({ kind: row.kind as OutputKind, id: row.id, purpose: row.purpose, contentHash: row.content_hash });

/**
 * Output generation and reads (M5 Step 7 checkpoint 2: BOM, BOQ, Pricing, Quotation). The controller is HTTP only;
 * every calculation is an engine's (via the engine entry modules), every rule the persistence contract's and the
 * database's. One request = one REPEATABLE READ transaction = one OutputExecutionContext.
 */
@Injectable()
export class OutputsService {
  private readonly engines: Readonly<Record<OutputEngine, EngineProvenance>>;

  constructor(
    @Inject(API_CONFIG) config: ApiConfig,
    @Inject(ENGINE_MANIFEST) manifest: EngineManifest,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(CursorCodec) private readonly cursors: CursorCodec,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {
    this.engines = outputEngines(manifest, config.buildRevision);
  }

  /* ------------------------------------------------------------ generation */

  generate(scope: RequestScope, kind: OutputKind, versionId: string, req: IdempotentRequest, body: GenerateRequest) {
    return this.uow.run(scope, { action: GENERATE_ACTION[kind], isolation: "REPEATABLE READ" }, (tx) =>
      this.idempotency.forRequest(tx, scope, IDEMPOTENCY[kind], req, body, async (): Promise<StoredResponse> => {
        const purpose: OutputPurpose = body.purpose;
        // Purpose × lifecycle first (plan §11): a refused request reads nothing further and records nothing.
        const v = await designVersionsRepository.get(tx, versionId);
        if (v === null) throw new ApiProblem("NOT_FOUND");
        assertPurposeAllowed(kind, purpose, v.status);
        const chosen = {
          pricingStandardVersionId: "pricingStandardVersionId" in body ? body.pricingStandardVersionId : null,
          quotationPolicyVersionId: "quotationPolicyVersionId" in body ? body.quotationPolicyVersionId : null,
        };
        const ctx = await buildOutputExecutionContext(tx, { orgId: scope.org.orgId, actorId: scope.principal.userId, versionId, commercial: chosen, engines: this.engines });
        const blockers = ctx.resolved.validation.counts.BLOCKER;
        if (purpose === "FOR_PRODUCTION" && blockers > 0) throw new ApiProblem("VALIDATION_BLOCKERS", `FOR_PRODUCTION requires 0 BLOCKERs (the validation of these inputs has ${String(blockers)})`);
        const outcome = await new OutputGeneration(tx, ctx, purpose, (body.sources ?? {}) as SnapshotSources).generate(kind);
        if (outcome.status === "UNAVAILABLE") {
          // Nothing of the requested kind is persisted; upstream snapshots created from the same context (and their run) are valid on their own.
          return { status: 200, body: { status: "UNAVAILABLE", kind: outcome.kind, blockers: outcome.blockers, snapshot: null, dependencies: outcome.upstream.map((p) => summary(p.row)) } };
        }
        const created = outcome.snapshot.created;
        return {
          status: created ? 201 : 200,
          body: await this.generated(tx, outcome.snapshot.row, !created, outcome.upstream),
          headers: { location: `/api/v1/${KIND_PATH[kind]}/${outcome.snapshot.row.id}` },
          resource: { type: SNAPSHOT_TABLE[kind], id: outcome.snapshot.row.id },
        };
      }, async (resource, status) => {
        // Replay of a result too large to store: the immutable snapshot is re-read (the same content, by content hash).
        const kindOfResource = KIND_OF_TABLE[resource.type];
        const row = kindOfResource === undefined ? null : await outputsRepository.get(tx, SNAPSHOT_TABLE[kindOfResource], resource.id);
        if (row === null) throw new ApiProblem("INTERNAL", "the replayed snapshot is not readable");
        return this.generated(tx, row as unknown as SnapshotRow, status === 200, await this.upstreamChain(tx, row as unknown as SnapshotRow));
      }));
  }

  private async generated(tx: Tx, row: SnapshotRow, reused: boolean, upstream: readonly Produced[] | readonly SnapshotRow[]) {
    const staleness = this.staleness(tx);
    return {
      status: "AVAILABLE" as const,
      snapshot: await this.snapshot(tx, row, staleness, true),
      reused,
      dependencies: upstream.map((u) => summary("row" in u ? u.row : u)),
    };
  }

  /** The transitive upstream snapshots of a stored snapshot (readable ones), nearest first. */
  private async upstreamChain(tx: Tx, row: SnapshotRow): Promise<SnapshotRow[]> {
    const out: SnapshotRow[] = [];
    const seen = new Set<string>();
    const visit = async (r: SnapshotRow): Promise<void> => {
      for (const [key, column] of Object.entries(SOURCE_COLUMN) as [keyof typeof SOURCE_COLUMN, (typeof SOURCE_COLUMN)[keyof typeof SOURCE_COLUMN]][]) {
        const id = r[column];
        if (id === undefined || seen.has(id)) continue;
        seen.add(id);
        const s = await outputsRepository.get(tx, SNAPSHOT_TABLE[SOURCE_KIND[key]], id);
        if (s === null) continue;
        out.push(s as unknown as SnapshotRow);
        await visit(s as unknown as SnapshotRow);
      }
    };
    await visit(row);
    return out;
  }

  /* ------------------------------------------------------------ reads */

  get(scope: RequestScope, kind: OutputKind, id: string) {
    return this.uow.run(scope, { readOnly: true, action: READ_ACTION[kind] }, async (tx) => {
      const row = await outputsRepository.get(tx, SNAPSHOT_TABLE[kind], id);
      if (row === null) throw new ApiProblem("NOT_FOUND");
      return this.snapshot(tx, row as unknown as SnapshotRow, this.staleness(tx), true);
    });
  }

  list(scope: RequestScope, kind: OutputKind, versionId: string, q: PageQuery) {
    return this.uow.run(scope, { readOnly: true, action: READ_ACTION[kind] }, async (tx) => {
      const v = await designVersionsRepository.get(tx, versionId);
      if (v === null) throw new ApiProblem("NOT_FOUND");
      const staleness = this.staleness(tx);
      const page = await keysetList(tx, {
        codec: this.cursors, collection: `design-versions/${versionId}/${KIND_PATH[kind]}`, orgId: scope.org.orgId, sort: SORTS.newestFirst, query: q, firstParam: 2,
        fetch: (t, p, params) => outputsRepository.list(t, SNAPSHOT_TABLE[kind], versionId, p, params), key: (r) => r.created_at, id: (r) => r.id, map: (r) => r as unknown as SnapshotRow,
      });
      return { items: await Promise.all(page.items.map((r) => this.snapshot(tx, r, staleness, false))), nextCursor: page.nextCursor };
    });
  }

  /**
   * Detailed staleness: the stored-hash staleness plus the engine comparators on the design version's CURRENT model
   * (one new execution context; nothing is recorded — the transaction is read-only).
   */
  detailedStaleness(scope: RequestScope, kind: OutputKind, id: string) {
    return this.uow.run(scope, { readOnly: true, action: READ_ACTION[kind], isolation: "REPEATABLE READ" }, async (tx) => {
      const found = await outputsRepository.get(tx, SNAPSHOT_TABLE[kind], id);
      if (found === null) throw new ApiProblem("NOT_FOUND");
      const row = found as unknown as SnapshotRow;
      const base = await this.staleness(tx).of(row);
      const ctx = await buildOutputExecutionContext(tx, {
        orgId: scope.org.orgId, actorId: scope.principal.userId, versionId: row.design_version_id, commercial: { pricingStandardVersionId: null, quotationPolicyVersionId: null }, engines: this.engines,
      });
      const stored = producedFrom(row, false);
      const change = stored.kind === "QUOTATION" ? checkQuotationStaleness(stored.payload, ctx.resolved) : compareRoomTrace(stored.payload.trace, stored.payload.roomFingerprint, ctx.resolved);
      return { ...base, model: { stale: change.stale, reasons: [...change.reasons], changedObjectIds: [...change.changedObjectIds] } };
    });
  }

  /* ------------------------------------------------------------ mapping */

  private staleness(tx: Tx): StalenessCalculator {
    return new StalenessCalculator(tx, (name) => (this.engines as Partial<Record<string, EngineProvenance>>)[name]?.fingerprint);
  }

  private async snapshot(tx: Tx, row: SnapshotRow, staleness: StalenessCalculator, withPayload: true): Promise<Snapshot>;
  private async snapshot(tx: Tx, row: SnapshotRow, staleness: StalenessCalculator, withPayload: false): Promise<SnapshotEnvelope>;
  private async snapshot(tx: Tx, row: SnapshotRow, staleness: StalenessCalculator, withPayload: boolean): Promise<Snapshot | SnapshotEnvelope> {
    const kind = row.kind as OutputKind;
    const run = await designVersionsRepository.run(tx, row.validation_run_id);
    if (run === null) throw new ApiProblem("INTERNAL", `validation run of snapshot ${row.id} is not readable`);
    const sources: Record<string, string> = {};
    for (const [key, column] of Object.entries(SOURCE_COLUMN)) if (row[column] !== undefined) sources[key] = row[column];
    const envelope: SnapshotEnvelope = {
      id: row.id,
      kind,
      purpose: row.purpose,
      designVersionId: row.design_version_id,
      designVersionStatus: row.design_version_status,
      designVersionContentHash: row.design_version_content_hash,
      input: { hash: row.input_hash, revision: row.input_revision },
      engineeringPins: pinsOf(row),
      commercial: row.pricing_standard_version_id === null || row.commercial_input_hash === null ? null
        : { pricingStandardVersionId: row.pricing_standard_version_id, quotationPolicyVersionId: row.quotation_policy_version_id, inputHash: row.commercial_input_hash },
      dependencyHashes: { ...row.dependency_hashes },
      dependencySetHash: row.dependency_set_hash,
      validationRun: {
        id: run.id, purpose: "OUTPUT_GENERATION", blockerCount: run.blocker_count, warningCount: run.warning_count,
        engine: { name: run.engine_name, version: run.engine_version, build: run.engine_build, fingerprint: run.engine_fingerprint, closure: run.engine_closure } as SnapshotEnvelope["engine"],
      },
      sources,
      engine: { name: row.engine_name, version: row.engine_version, build: row.engine_build, fingerprint: row.engine_fingerprint, closure: row.engine_closure, seal: row.engine_seal },
      contentHash: row.content_hash,
      blockerCount: row.blocker_count,
      warningCount: row.warning_count,
      outputComplete: row.output_complete,
      dataClassification: row.data_classification,
      qualifiesForIssue: qualifiesForIssue(kind, row.purpose),
      qualifiesForRelease: qualifiesForRelease(kind, row.purpose),
      ...(row.revision_number === undefined ? {} : { revisionNumber: row.revision_number }),
      staleness: await staleness.of(row),
      createdBy: row.created_by,
      createdAt: iso(row.created_at),
    };
    // Responses carry the validated payload only (schema + content hash + engine seal).
    return withPayload ? { ...envelope, payload: producedFrom(row, false).payload } : envelope;
  }
}
