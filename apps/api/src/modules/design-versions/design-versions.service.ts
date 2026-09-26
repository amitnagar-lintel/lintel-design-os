import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ROOM_ENGINE_VERSION } from "@lintel/design-engine";
import type { RequestScope } from "../../common/auth/context.js";
import type { PermissionAction } from "../../common/auth/permissions.js";
import { UnitOfWork } from "../../common/db/unit-of-work.js";
import { ApiProblem } from "../../common/errors/api-problem.js";
import { assertWritable } from "../../common/http/etag.js";
import { keysetList } from "../../common/http/list.js";
import { CursorCodec, SORTS } from "../../common/http/pagination.js";
import type { IdempotentRequest } from "../../common/http/request.js";
import type { PageQuery } from "../../common/http/schemas.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import type { StoredResponse } from "../../common/idempotency/idempotency.service.js";
import type { DesignVersionRow } from "../../infrastructure/persistence/design-versions.repository.js";
import { designVersionsRepository as repo } from "../../infrastructure/persistence/design-versions.repository.js";
import { designsRepository } from "../../infrastructure/persistence/designs.repository.js";
import { roomsRepository } from "../../infrastructure/persistence/rooms.repository.js";
import { etagOf, lockDraft, mergePins, pinsOf, refreshHashes, toVersion } from "./design-content.js";
import type { TransitionRequest, VersionCreate, VersionUpdate } from "./design-versions.schemas.js";

/** Which action each lifecycle transition needs (the database's transition() checks the same, authoritatively). */
const TRANSITION_ACTIONS: Readonly<Record<TransitionRequest["action"], readonly PermissionAction[]>> = {
  SUBMIT: ["design_version.author"],
  REQUEST_CHANGES: ["design_version.approve"],
  APPROVE: ["design_version.approve"],
  LOCK: ["design_version.lock", "quotation.issue", "drawing.issue", "manufacturing.release"],
};

/**
 * DesignVersions: exact pins, draft metadata, and the lifecycle — which changes ONLY through design_os.transition()
 * (DRAFT → IN_REVIEW → APPROVED → LOCKED, SUPERSEDED on approval of a successor). No update path touches status.
 */
@Injectable()
export class DesignVersionsService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(CursorCodec) private readonly cursors: CursorCodec,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  create(scope: RequestScope, designId: string, req: IdempotentRequest, b: VersionCreate) {
    return this.uow.run(scope, { action: "design_version.author" }, (tx) => this.idempotency.forRequest(tx, scope, "design_version.create", req, b, async () => {
      // Lock the design: version numbers are assigned serially.
      const design = await designsRepository.get(tx, designId, true);
      if (design === null) throw new ApiProblem("NOT_FOUND");
      let base: DesignVersionRow | null = null;
      if (b.basedOnVersionId !== undefined) {
        base = await repo.get(tx, b.basedOnVersionId);
        if (base === null || base.entity_id !== designId) throw new ApiProblem("INVALID_REFERENCE", "basedOnVersionId must be a version of this design");
      }
      const roomRevisionId = b.roomRevisionId ?? base?.room_revision_id ?? (await roomsRepository.latestRevision(tx, design.room_id))?.id;
      if (roomRevisionId === undefined) throw new ApiProblem("INVALID_REFERENCE", "the design's room has no survey revision yet");
      const pins = mergePins(base === null ? {} : pinsOf(base), b.pins);
      const draft = {
        id: randomUUID(), org_id: scope.org.orgId, entity_id: designId, project_id: design.project_id, based_on_version_id: base?.id ?? null, room_revision_id: roomRevisionId,
        ...pins, authored_engine_version: ROOM_ENGINE_VERSION, version_number: await repo.nextVersionNumber(tx, designId),
        version_label: b.versionLabel ?? null, source: b.source ?? "api", change_reason: b.changeReason, created_by: scope.principal.userId,
      };
      // Provisional hashes; the exact ones are computed from the stored rows once the content is copied.
      const provisional = `sha256:${"0".repeat(64)}`;
      const inserted = await repo.insert(tx, { ...draft, input_hash: provisional, content_hash: provisional });
      if (inserted === null) throw new ApiProblem("INTERNAL");
      if (base !== null) {
        // Copy-on-write: same lineage ids, new rows; the product must be in the (possibly re-pinned) product catalog.
        for (const o of await repo.objects(tx, base.id)) await repo.insertObject(tx, { ...o, id: randomUUID(), design_version_id: inserted.id });
        for (const o of await repo.overrides(tx, base.id)) await repo.insertOverrideCopy(tx, { ...o, design_version_id: inserted.id });
      }
      const v = await refreshHashes(tx, inserted.id);
      return { status: 201, body: toVersion(v, null), headers: { etag: etagOf(v), location: `/api/v1/design-versions/${v.id}` } };
    }));
  }

  get(scope: RequestScope, id: string): Promise<StoredResponse> {
    return this.uow.run(scope, { readOnly: true }, async (tx) => {
      const v = await repo.get(tx, id);
      if (v === null) throw new ApiProblem("NOT_FOUND");
      return { status: 200, body: toVersion(v, await repo.latestRun(tx, id)), headers: { etag: etagOf(v) } };
    });
  }

  list(scope: RequestScope, designId: string, q: PageQuery) {
    return this.uow.run(scope, { readOnly: true }, async (tx) => {
      if ((await designsRepository.get(tx, designId)) === null) throw new ApiProblem("NOT_FOUND");
      return keysetList(tx, {
        codec: this.cursors, collection: `designs/${designId}/versions`, orgId: scope.org.orgId, sort: SORTS.versionNumberDesc, query: q, firstParam: 2,
        fetch: (t, page, params) => repo.list(t, designId, page, params), key: (r) => r.version_number, id: (r) => r.id, map: (r) => toVersion(r, null),
      });
    });
  }

  /** Draft metadata, room revision and pins (DRAFT only; If-Match on the whole-draft ETag). */
  update(scope: RequestScope, id: string, ifMatch: string | undefined, b: VersionUpdate): Promise<StoredResponse> {
    return this.uow.run(scope, { action: "design_version.author" }, async (tx) => {
      const v = await lockDraft(tx, id, ifMatch);
      const pins = mergePins(pinsOf(v), b.pins);
      if (pins.product_catalog_version_id !== v.product_catalog_version_id) {
        // Every placed object's exact product version must belong to the newly pinned product catalog version.
        const objects = await repo.objects(tx, id);
        const outside = await repo.productsOutsideCatalog(tx, pins.product_catalog_version_id ?? "", [...new Set(objects.map((o) => o.product_version_id))]);
        if (outside.length > 0) throw new ApiProblem("INVALID_REFERENCE", "placed objects use product versions that are not in the new product catalog version", { context: { productVersionIds: outside } });
      }
      const updated = await repo.updateDraft(tx, id, {
        ...pins,
        room_revision_id: b.roomRevisionId ?? v.room_revision_id,
        version_label: b.versionLabel === undefined ? v.version_label : b.versionLabel,
        change_reason: b.changeReason ?? v.change_reason,
        source: b.source ?? v.source,
      });
      if (updated === null) throw new ApiProblem("NOT_FOUND");
      const next = await refreshHashes(tx, id);
      return { status: 200, body: toVersion(next, await repo.latestRun(tx, id)), headers: { etag: etagOf(next) } };
    });
  }

  /**
   * The ONLY way a design version's lifecycle changes: design_os.transition(). If-Match guards against acting on a
   * stale view; the decision's recorded content hash must be the content the caller saw (closes the read→lock race).
   */
  transition(scope: RequestScope, id: string, ifMatch: string | undefined, req: IdempotentRequest, b: TransitionRequest) {
    const needed = TRANSITION_ACTIONS[b.action];
    if (!needed.some((a) => scope.org.permissions.has(a))) throw new ApiProblem("PERMISSION_DENIED");
    return this.uow.run(scope, { action: needed, reason: b.reason }, (tx) => this.idempotency.forRequest(tx, scope, "transition", req, b, async () => {
      const before = await repo.get(tx, id);
      if (before === null) throw new ApiProblem("NOT_FOUND");
      assertWritable({ ifMatch, currentEtag: etagOf(before) });
      await repo.transition(tx, id, b.action, b.reason, b.expectedContentHash ?? null);
      if ((await repo.latestDecisionHash(tx, id)) !== before.content_hash) throw new ApiProblem("STALE_VERSION");
      const after = await repo.get(tx, id);
      if (after === null) throw new ApiProblem("NOT_FOUND");
      return { status: 200, body: toVersion(after, await repo.latestRun(tx, id)), headers: { etag: etagOf(after) } };
    }));
  }
}
