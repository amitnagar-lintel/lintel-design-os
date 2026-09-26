import { Inject, Injectable } from "@nestjs/common";
import type { EngineProvenance, OutputPurpose, Sha256, SnapshotRow, SnapshotSources } from "@lintel/persistence";
import { fileManifestHash, qualifiesForIssue, qualifiesForRelease } from "@lintel/persistence";
import { compareRoomTrace } from "@lintel/design-engine";
import { checkDrawingStaleness, checkRoomDrawingStaleness } from "@lintel/drawing-engine";
import { checkQuotationStaleness } from "@lintel/pricing-engine";
import { FileService } from "@lintel/storage";
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
import { API_CONFIG, ENGINE_MANIFEST, FILE_STORAGE } from "../../common/tokens.js";
import type { ApiConfig } from "../../config.js";
import type { EngineManifest } from "../../infrastructure/engines/engine-manifest.js";
import { designVersionsRepository } from "../../infrastructure/persistence/design-versions.repository.js";
import type { DrawingFileLinkRow } from "../../infrastructure/persistence/files.repository.js";
import { filesRepository } from "../../infrastructure/persistence/files.repository.js";
import { issuesRepository } from "../../infrastructure/persistence/issues.repository.js";
import type { SigningStorageProvider } from "../../infrastructure/storage/file-storage.js";
import { outputsRepository } from "../../infrastructure/persistence/outputs.repository.js";
import { pinsOf } from "../design-versions/design-content.js";
import type { OutputEngine, OutputKind } from "./output-context.js";
import { buildOutputExecutionContext, outputEngines } from "./output-context.js";
import type { DrawingOrder, Produced } from "./output-generation.js";
import { OutputGeneration, READ_ACTION, GENERATE_ACTION, SNAPSHOT_TABLE, SOURCE_COLUMN, SOURCE_KIND, assertPurposeAllowed, producedFrom } from "./output-generation.js";
import type { DrawingGenerateRequest, GenerateRequest, Snapshot, SnapshotEnvelope, SnapshotFileResponse } from "./outputs.schemas.js";
import { StalenessCalculator } from "./staleness.js";

const IDEMPOTENCY: Readonly<Record<OutputKind, IdempotencyScope>> = {
  BOM: "snapshot.bom.generate", BOQ: "snapshot.boq.generate", PRICING: "snapshot.pricing.generate", QUOTATION: "snapshot.quotation.generate", DRAWING: "snapshot.drawing.generate",
};
export const KIND_PATH: Readonly<Record<OutputKind, string>> = {
  BOM: "bom-snapshots", BOQ: "boq-snapshots", PRICING: "pricing-snapshots", QUOTATION: "quotation-snapshots", DRAWING: "drawing-snapshots",
};
const KINDS: readonly OutputKind[] = ["BOM", "BOQ", "PRICING", "QUOTATION", "DRAWING"];

/** The drawing to generate, from a validated request (engine parameters, number and revision only). */
function drawingOrder(b: DrawingGenerateRequest): DrawingOrder {
  const common = { drawingNumber: b.drawingNumber, drawingRevision: b.drawingRevision };
  switch (b.drawingType) {
    case "WALL_INTERNAL_ELEVATION": return { drawingType: b.drawingType, wallId: b.wallId, ...common };
    case "ROOM_PANEL_SCHEDULE": return { drawingType: b.drawingType, ...common };
    case "SIDE_SECTION": return { drawingType: b.drawingType, objectLineageId: b.objectLineageId, cutXMm: b.cutXMm ?? null, ...common };
    case "FRONT_ELEVATION":
    case "CABINET_INTERNAL_ELEVATION":
    case "PANEL_SCHEDULE":
      return { drawingType: b.drawingType, objectLineageId: b.objectLineageId, ...common };
  }
}

const fileOf = (l: DrawingFileLinkRow): SnapshotFileResponse => ({
  sequence: l.sequence, format: l.format, sheetIndex: l.sheet_index, fileId: l.file_object_id, contentType: l.content_type, byteSize: l.byte_size, checksum: l.checksum,
});
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
  private readonly fileService: FileService;

  constructor(
    @Inject(API_CONFIG) config: ApiConfig,
    @Inject(ENGINE_MANIFEST) manifest: EngineManifest,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(CursorCodec) private readonly cursors: CursorCodec,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(FILE_STORAGE) storage: SigningStorageProvider,
  ) {
    this.engines = outputEngines(manifest, config.buildRevision);
    // Output files are immutable evidence: this service never deletes one (every stored file counts as referenced).
    this.fileService = new FileService(storage, () => Promise.resolve(true));
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
        const drawing = "drawingType" in body ? { order: drawingOrder(body), sink: { service: this.fileService, formats: await filesRepository.formats(tx) } } : undefined;
        const sources = "sources" in body ? (body.sources ?? {}) as SnapshotSources : {};
        const outcome = await new OutputGeneration(tx, ctx, purpose, sources, drawing).generate(kind);
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
      let change: { readonly stale: boolean; readonly reasons: readonly string[]; readonly changedObjectIds: readonly string[] };
      if (stored.kind === "QUOTATION") change = checkQuotationStaleness(stored.payload, ctx.resolved);
      else if (stored.kind !== "DRAWING") change = compareRoomTrace(stored.payload.trace, stored.payload.roomFingerprint, ctx.resolved);
      else if ("wallId" in stored.payload) change = checkRoomDrawingStaleness(stored.payload, ctx.resolved);
      else {
        const objectId = stored.payload.trace.objectId;
        const cabinet = ctx.resolved.cabinets.find((c) => c.object.objectId === objectId);
        const d = cabinet === undefined ? { stale: true, reasons: [`Object removed: ${objectId}`] } : checkDrawingStaleness(stored.payload, cabinet);
        change = { ...d, changedObjectIds: d.stale ? [objectId] : [] };
      }
      return { ...base, model: { stale: change.stale, reasons: [...change.reasons], changedObjectIds: [...change.changedObjectIds] } };
    });
  }

  /** A drawing snapshot's files, in manifest order, after verifying they are exactly its sealed file manifest. */
  files(scope: RequestScope, snapshotId: string) {
    return this.uow.run(scope, { readOnly: true, action: READ_ACTION.DRAWING }, async (tx) => {
      const row = await outputsRepository.get(tx, "drawing_snapshot", snapshotId);
      if (row === null) throw new ApiProblem("NOT_FOUND");
      return { items: (await this.drawingOf(tx, row as unknown as SnapshotRow)).files };
    });
  }

  /**
   * Every output of a design version the caller may read (no payloads), its OUTPUT_GENERATION runs, and the edges
   * between them: SOURCE (upstream snapshot → output) and EVIDENCE (run → output). Kinds the caller cannot read are
   * listed as hidden, never partially shown.
   */
  graph(scope: RequestScope, versionId: string) {
    return this.uow.run(scope, { readOnly: true }, async (tx) => {
      const v = await designVersionsRepository.get(tx, versionId);
      if (v === null) throw new ApiProblem("NOT_FOUND");
      const staleness = this.staleness(tx);
      const nodes: SnapshotEnvelope[] = [];
      const hiddenKinds: OutputKind[] = [];
      for (const kind of KINDS) {
        if (!(await outputsRepository.hasPermission(tx, READ_ACTION[kind]))) {
          hiddenKinds.push(kind);
          continue;
        }
        for (const r of await outputsRepository.all(tx, SNAPSHOT_TABLE[kind], versionId)) nodes.push(await this.snapshot(tx, r as unknown as SnapshotRow, staleness, false));
      }
      const ids = new Set(nodes.map((n) => n.id));
      const runs = (await designVersionsRepository.outputRuns(tx, versionId)).map((r) => ({
        id: r.id, inputHash: r.input_hash, inputRevision: r.input_revision, blockerCount: r.blocker_count, warningCount: r.warning_count,
        engine: { name: r.engine_name, version: r.engine_version, build: r.engine_build, fingerprint: r.engine_fingerprint }, createdAt: iso(r.created_at),
      }));
      const edges = nodes.flatMap((n) => [
        ...Object.entries(n.sources).filter((e): e is [string, string] => e[1] !== undefined && ids.has(e[1])).map(([source, id]) => ({ from: id, to: n.id, relation: "SOURCE" as const, source })),
        { from: n.validationRun.id, to: n.id, relation: "EVIDENCE" as const },
      ]);
      return { designVersionId: versionId, designVersionStatus: v.status, nodes, validationRuns: runs, edges, hiddenKinds };
    });
  }

  /**
   * Drawing identity and files: the linked files must be exactly the sealed manifest (re-verified on every read,
   * beside the database's commit-time check); a mismatch is never served.
   */
  private async drawingOf(tx: Tx, row: SnapshotRow): Promise<NonNullable<SnapshotEnvelope["drawing"]>> {
    const links = await filesRepository.links(tx, row.id);
    const files = links.map(fileOf);
    if (fileManifestHash(files.map((f) => ({ ...f, checksum: f.checksum as Sha256 }))) !== row.file_manifest_hash) {
      throw new ApiProblem("STORED_OUTPUT_INVALID", `drawing snapshot ${row.id}: linked files do not match the sealed file manifest`, { context: { kind: "DRAWING", snapshotId: row.id, reason: "FILE_MANIFEST" } });
    }
    const cut = row.cut_x_mm ?? null;
    return {
      drawingType: row.drawing_type ?? "FRONT_ELEVATION", scope: row.drawing_scope ?? "OBJECT", wallId: row.wall_id ?? null, objectLineageId: row.object_lineage_id ?? null,
      cutXMm: cut === null ? null : Number(cut), drawingNumber: row.drawing_number ?? "", drawingRevision: row.drawing_revision ?? "", fileManifestHash: row.file_manifest_hash ?? fileManifestHash([]), files,
    };
  }

  /** The immutable issue record of a quotation / drawing snapshot (null while not issued). */
  private async issueOf(tx: Tx, kind: "QUOTATION" | "DRAWING", snapshotId: string): Promise<{ issuedBy: string; issuedAt: string; reason: string } | null> {
    const r = kind === "QUOTATION" ? await issuesRepository.quotation(tx, snapshotId) : await issuesRepository.drawing(tx, snapshotId);
    return r === null ? null : { issuedBy: r.issued_by, issuedAt: iso(r.issued_at), reason: r.reason };
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
      ...(kind === "DRAWING" ? { drawing: await this.drawingOf(tx, row) } : {}),
      ...(kind === "QUOTATION" || kind === "DRAWING" ? { issue: await this.issueOf(tx, kind, row.id) } : {}),
      staleness: await staleness.of(row),
      createdBy: row.created_by,
      createdAt: iso(row.created_at),
    };
    // Responses carry the validated payload only (schema + content hash + engine seal).
    return withPayload ? { ...envelope, payload: producedFrom(row, false).payload } : envelope;
  }
}
