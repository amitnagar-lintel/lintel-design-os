import { Inject, Injectable } from "@nestjs/common";
import type { EngineProvenance } from "@lintel/persistence";
import { buildValidationRun, recordValidationRunArgs } from "@lintel/persistence";
import type { RequestScope } from "../../common/auth/context.js";
import { UnitOfWork } from "../../common/db/unit-of-work.js";
import { API_CONFIG, ENGINE_MANIFEST } from "../../common/tokens.js";
import type { ApiConfig } from "../../config.js";
import { ApiProblem } from "../../common/errors/api-problem.js";
import { assertWritable, parseIfMatch } from "../../common/http/etag.js";
import { iso } from "../../common/http/format.js";
import { keysetList } from "../../common/http/list.js";
import { CursorCodec, SORTS } from "../../common/http/pagination.js";
import type { IdempotentRequest } from "../../common/http/request.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import { designInputsRepository } from "../../infrastructure/persistence/design-inputs.repository.js";
import type { DesignVersionRow, ValidationRunRow } from "../../infrastructure/persistence/design-versions.repository.js";
import { designVersionsRepository as repo } from "../../infrastructure/persistence/design-versions.repository.js";
import { roomsRepository } from "../../infrastructure/persistence/rooms.repository.js";
import { computeInputHash, etagOf, isCurrent } from "./design-content.js";
import type { ValidationRunQuery, ValidationRunResponse } from "./design-versions.schemas.js";
import type { EngineManifest } from "../../infrastructure/engines/engine-manifest.js";
import { engineProvenance } from "../../infrastructure/engines/engine-manifest.js";
import { runDesignEngine } from "../outputs/engines/validation.js";

function toRun(r: ValidationRunRow, v: DesignVersionRow): ValidationRunResponse {
  return {
    id: r.id, designVersionId: r.design_version_id, purpose: r.purpose, inputHash: r.input_hash, inputRevision: r.input_revision, dependencySetHash: r.dependency_set_hash,
    engine: { name: r.engine_name, version: r.engine_version, build: r.engine_build, fingerprint: r.engine_fingerprint, closure: r.engine_closure },
    contentHash: r.content_hash, blockerCount: r.blocker_count, warningCount: r.warning_count, canApprove: r.blocker_count === 0, current: isCurrent(r, v),
    messages: r.messages as ValidationRunResponse["messages"], createdBy: r.created_by, createdAt: iso(r.created_at),
  };
}

/**
 * Validation: the TypeScript engine decides; the database stores the result immutably through its only write path,
 * design_os.record_validation_run(), bound to the exact input hash AND database input revision. The client submits
 * nothing but the request: blocker and warning counts always come from the engine run here.
 */
@Injectable()
export class ValidationService {
  private readonly engine: EngineProvenance;
  constructor(
    @Inject(API_CONFIG) config: ApiConfig,
    @Inject(ENGINE_MANIFEST) manifest: EngineManifest,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(CursorCodec) private readonly cursors: CursorCodec,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {
    this.engine = engineProvenance(manifest, "validation", config.buildRevision);
  }

  /**
   * One REPEATABLE READ transaction: the inputs read, the engine result and the recorded run all belong to one
   * snapshot. If the inputs change concurrently, record_validation_run's lock sees it and the request fails
   * (CONCURRENT_MODIFICATION / VALIDATION_INPUT_MISMATCH) — a stale result is never recorded.
   */
  validate(scope: RequestScope, versionId: string, ifMatch: string | undefined, req: IdempotentRequest, body: unknown) {
    return this.uow.run(scope, { action: ["design_version.author", "output.generate.engineering"], isolation: "REPEATABLE READ" }, (tx) =>
      this.idempotency.forRequest(tx, scope, "validation_run.record", req, body, async () => {
        const v = await repo.get(tx, versionId);
        if (v === null) throw new ApiProblem("NOT_FOUND");
        if (parseIfMatch(ifMatch) !== null) assertWritable({ ifMatch, currentEtag: etagOf(v) });
        const canRead = await tx.one<{ ok: boolean }>("SELECT design_os.has_permission('reference.read') AS ok");
        if (!canRead.ok) throw new ApiProblem("PERMISSION_DENIED", "validation reads the pinned reference data (reference.read)");
        const { inputHash, objects, overrides } = await computeInputHash(tx, v);
        if (inputHash !== v.input_hash) throw new ApiProblem("VALIDATION_INPUT_MISMATCH", "the stored input hash does not match the stored inputs");
        const revision = await roomsRepository.revision(tx, v.room_revision_id);
        const room = revision === null ? null : await roomsRepository.get(tx, revision.room_id);
        if (revision === null || room === null) throw new ApiProblem("INTERNAL", "room survey not readable");
        const pinned = await designInputsRepository.pinned(tx, {
          construction_standard_version_id: v.construction_standard_version_id ?? "", planning_standard_version_id: v.planning_standard_version_id ?? "",
          edge_band_standard_version_id: v.edge_band_standard_version_id ?? "", material_catalog_version_id: v.material_catalog_version_id ?? "",
          finish_catalog_version_id: v.finish_catalog_version_id ?? "", hardware_catalog_version_id: v.hardware_catalog_version_id ?? "",
          product_catalog_version_id: v.product_catalog_version_id ?? "", hettich_dataset_version_id: v.hettich_dataset_version_id ?? "",
          appliance_catalog_version_id: v.appliance_catalog_version_id ?? null,
        });
        const resolved = runDesignEngine({ version: v, room, revision, objects, overrides, pinned });
        // APPROVAL evidence (SUBMIT / APPROVE). OUTPUT_GENERATION runs are recorded only by output generation.
        const run = buildValidationRun({ purpose: "APPROVAL", designVersionId: v.id, inputHash, engine: this.engine, validation: resolved.validation });
        const runId = await repo.recordRun(tx, recordValidationRunArgs(run));
        const stored = await repo.run(tx, runId);
        const current = await repo.get(tx, versionId);
        if (stored === null || current === null) throw new ApiProblem("INTERNAL");
        return { status: 201, body: toRun(stored, current), headers: { location: `/api/v1/validation-runs/${runId}` } };
      }));
  }

  list(scope: RequestScope, versionId: string, q: ValidationRunQuery) {
    return this.uow.run(scope, { readOnly: true }, async (tx) => {
      const v = await repo.get(tx, versionId);
      if (v === null) throw new ApiProblem("NOT_FOUND");
      return keysetList(tx, {
        codec: this.cursors, collection: `design-versions/${versionId}/validation-runs?purpose=${q.purpose ?? "*"}`, orgId: scope.org.orgId, sort: SORTS.sequenceDesc, query: q, firstParam: 3,
        fetch: (t, page, params) => repo.runs(t, versionId, q.purpose ?? null, page, params), key: (r) => r.seq, id: (r) => r.id, map: (r) => toRun(r, v),
      });
    });
  }

  get(scope: RequestScope, runId: string) {
    return this.uow.run(scope, { readOnly: true }, async (tx) => {
      const r = await repo.run(tx, runId);
      const v = r === null ? null : await repo.get(tx, r.design_version_id);
      if (r === null || v === null) throw new ApiProblem("NOT_FOUND");
      return toRun(r, v);
    });
  }
}
