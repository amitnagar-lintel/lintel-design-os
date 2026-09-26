import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { RequestScope } from "../../common/auth/context.js";
import type { Tx } from "../../common/db/tx.js";
import { UnitOfWork } from "../../common/db/unit-of-work.js";
import { ApiProblem } from "../../common/errors/api-problem.js";
import { keysetList } from "../../common/http/list.js";
import { CursorCodec, SORTS } from "../../common/http/pagination.js";
import type { IdempotentRequest } from "../../common/http/request.js";
import type { PageQuery } from "../../common/http/schemas.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import type { StoredResponse } from "../../common/idempotency/idempotency.service.js";
import type { DesignObjectRow } from "../../infrastructure/persistence/design-versions.repository.js";
import { designVersionsRepository as repo } from "../../infrastructure/persistence/design-versions.repository.js";
import { etagOf, lockDraft, refreshHashes, stateOf, toObject, toOverride } from "./design-content.js";
import type { ObjectInput, ObjectUpdate, OverrideCreate } from "./design-versions.schemas.js";

/**
 * Draft content of a DesignVersion: design objects and relationship overrides. Every write locks the parent version,
 * requires it to be DRAFT (then If-Match on its whole-draft ETag), and recomputes its input / content hashes in the same
 * transaction. The database enforces the same (draft-only content, product-catalog membership, quarter turns).
 */
@Injectable()
export class DesignObjectsService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(CursorCodec) private readonly cursors: CursorCodec,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  private async finish(tx: Tx, versionId: string, status: number, body: Record<string, unknown>, location?: string): Promise<StoredResponse> {
    const v = await refreshHashes(tx, versionId);
    return { status, body: { ...body, designVersion: stateOf(v) }, headers: { etag: etagOf(v), ...(location === undefined ? {} : { location }) } };
  }

  list(scope: RequestScope, versionId: string, q: PageQuery) {
    return this.uow.run(scope, { readOnly: true }, async (tx) => {
      if ((await repo.get(tx, versionId)) === null) throw new ApiProblem("NOT_FOUND");
      return keysetList(tx, {
        codec: this.cursors, collection: `design-versions/${versionId}/objects`, orgId: scope.org.orgId, sort: SORTS.objectCodeAsc, query: q, firstParam: 2,
        fetch: (t, page, params) => repo.objectPage(t, versionId, page, params), key: (r) => r.object_code, id: (r) => r.id, map: toObject,
      });
    });
  }

  get(scope: RequestScope, objectId: string) {
    return this.uow.run(scope, { readOnly: true }, async (tx) => {
      const o = await repo.object(tx, objectId);
      if (o === null) throw new ApiProblem("NOT_FOUND");
      return toObject(o);
    });
  }

  /** Create is idempotent by the natural keys (object code and lineage id are unique per version). */
  create(scope: RequestScope, versionId: string, ifMatch: string | undefined, b: ObjectInput): Promise<StoredResponse> {
    return this.uow.run(scope, { action: "design_version.author" }, async (tx) => {
      await lockDraft(tx, versionId, ifMatch);
      const row: DesignObjectRow = {
        id: randomUUID(), org_id: scope.org.orgId, design_version_id: versionId, object_code: b.objectCode, lineage_id: b.lineageId ?? randomUUID(),
        object_type: b.objectType, product_code: b.productCode, product_version_id: b.productVersionId,
        x_mm: b.position.xMm, y_mm: b.position.yMm, z_mm: b.position.zMm, rotation_y: b.rotationY,
        width_mm: b.dimensions.widthMm, height_mm: b.dimensions.heightMm, depth_mm: b.dimensions.depthMm, parameters: b.parameters, status: "DRAFT",
      };
      const created = await repo.insertObject(tx, row);
      if (created === null) throw new ApiProblem("INTERNAL");
      return this.finish(tx, versionId, 201, { object: toObject(created) }, `/api/v1/design-objects/${created.id}`);
    });
  }

  update(scope: RequestScope, objectId: string, ifMatch: string | undefined, b: ObjectUpdate): Promise<StoredResponse> {
    return this.uow.run(scope, { action: "design_version.author" }, async (tx) => {
      const current = await repo.object(tx, objectId);
      if (current === null) throw new ApiProblem("NOT_FOUND");
      await lockDraft(tx, current.design_version_id, ifMatch);
      const next: DesignObjectRow = {
        ...current,
        product_code: b.product?.productCode ?? current.product_code,
        product_version_id: b.product?.productVersionId ?? current.product_version_id,
        x_mm: b.position?.xMm ?? current.x_mm, y_mm: b.position?.yMm ?? current.y_mm, z_mm: b.position?.zMm ?? current.z_mm,
        rotation_y: b.rotationY ?? current.rotation_y,
        width_mm: b.dimensions?.widthMm ?? current.width_mm, height_mm: b.dimensions?.heightMm ?? current.height_mm, depth_mm: b.dimensions?.depthMm ?? current.depth_mm,
        parameters: b.parameters ?? current.parameters,
      };
      const updated = await repo.updateObject(tx, next);
      if (updated === null) throw new ApiProblem("NOT_FOUND");
      return this.finish(tx, current.design_version_id, 200, { object: toObject(updated) });
    });
  }

  remove(scope: RequestScope, objectId: string, ifMatch: string | undefined): Promise<StoredResponse> {
    return this.uow.run(scope, { action: "design_version.author" }, async (tx) => {
      const current = await repo.object(tx, objectId);
      if (current === null) throw new ApiProblem("NOT_FOUND");
      await lockDraft(tx, current.design_version_id, ifMatch);
      const referencing = (await repo.overrides(tx, current.design_version_id)).filter((o) => o.object_ids.includes(current.lineage_id)).map((o) => o.override_code);
      if (referencing.length > 0) throw new ApiProblem("INVALID_REFERENCE", "relationship overrides still reference this object", { context: { overrideCodes: [...new Set(referencing)] } });
      if (!(await repo.deleteObject(tx, objectId))) throw new ApiProblem("NOT_FOUND");
      return this.finish(tx, current.design_version_id, 200, { deleted: { id: objectId, lineageId: current.lineage_id } });
    });
  }

  overrides(scope: RequestScope, versionId: string) {
    return this.uow.run(scope, { readOnly: true }, async (tx) => {
      if ((await repo.get(tx, versionId)) === null) throw new ApiProblem("NOT_FOUND");
      return { items: (await repo.overrides(tx, versionId)).map(toOverride) };
    });
  }

  /** Appends a new version of the override (history kept). Every object id must be a lineage id placed in this version. */
  addOverride(scope: RequestScope, versionId: string, ifMatch: string | undefined, req: IdempotentRequest, b: OverrideCreate) {
    return this.uow.run(scope, { action: "design_version.author" }, (tx) => this.idempotency.forRequest(tx, scope, "relationship_override.create", req, b, async () => {
      await lockDraft(tx, versionId, ifMatch);
      const lineages = new Set((await repo.objects(tx, versionId)).map((o) => o.lineage_id));
      const unknown = b.objectIds.filter((id) => !lineages.has(id));
      if (unknown.length > 0) throw new ApiProblem("INVALID_REFERENCE", "objectIds must be lineage ids of objects in this design version", { context: { unknownObjectIds: unknown } });
      const row = await repo.insertOverride(tx, {
        org_id: scope.org.orgId, design_version_id: versionId, override_code: b.overrideCode, version: await repo.nextOverrideVersion(tx, versionId, b.overrideCode),
        kind: b.kind, object_ids: b.objectIds, reason: b.reason, created_by: scope.principal.userId,
      });
      if (row === null) throw new ApiProblem("INTERNAL");
      return this.finish(tx, versionId, 201, { override: toOverride(row) });
    }));
  }

  /** Removes an override (every version of its code) from a DRAFT; the audit chain keeps the history. */
  removeOverride(scope: RequestScope, versionId: string, code: string, ifMatch: string | undefined): Promise<StoredResponse> {
    return this.uow.run(scope, { action: "design_version.author" }, async (tx) => {
      await lockDraft(tx, versionId, ifMatch);
      const removed = await repo.deleteOverride(tx, versionId, code);
      if (removed === 0) throw new ApiProblem("NOT_FOUND");
      return this.finish(tx, versionId, 200, { deleted: { overrideCode: code, versions: removed } });
    });
  }
}
