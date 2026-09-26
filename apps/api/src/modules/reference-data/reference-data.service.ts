import { Inject, Injectable } from "@nestjs/common";
import type { RequestScope } from "../../common/auth/context.js";
import type { PermissionAction } from "../../common/auth/permissions.js";
import { UnitOfWork } from "../../common/db/unit-of-work.js";
import { ApiProblem } from "../../common/errors/api-problem.js";
import { versionEtag } from "../../common/http/etag.js";
import { iso } from "../../common/http/format.js";
import { keysetList } from "../../common/http/list.js";
import { CursorCodec, SORTS } from "../../common/http/pagination.js";
import type { PageQuery } from "../../common/http/schemas.js";
import type { StoredResponse } from "../../common/idempotency/idempotency.service.js";
import type { EntityRow, VersionRow } from "../../infrastructure/persistence/reference-data.repository.js";
import { referenceDataRepository as repo } from "../../infrastructure/persistence/reference-data.repository.js";
import type { ArticleListQuery, EntityListQuery, ReferenceEntity, ReferenceType, ReferenceTypeList, ReferenceVersion, ReferenceVersionDetail, VersionListQuery } from "./reference-data.schemas.js";
import { REFERENCE_TYPES } from "./reference-data.schemas.js";

/** Author / approve actions per type (the same strings as design_os.versioned_table; a database test asserts parity). */
const ACTIONS: Readonly<Record<ReferenceType, { author: PermissionAction; approve: PermissionAction }>> = {
  construction_standard: { author: "construction_standard.author", approve: "construction_standard.approve" },
  planning_standard: { author: "planning_standard.author", approve: "planning_standard.approve" },
  edge_band_standard: { author: "edge_band_standard.author", approve: "edge_band_standard.approve" },
  material: { author: "material_catalog.author", approve: "material_catalog.approve" },
  edge_band: { author: "material_catalog.author", approve: "material_catalog.approve" },
  finish: { author: "finish_catalog.author", approve: "finish_catalog.approve" },
  hardware_item: { author: "hardware_catalog.author", approve: "hardware_catalog.approve" },
  hardware_rule_set: { author: "hardware_catalog.author", approve: "hardware_catalog.approve" },
  appliance: { author: "appliance_catalog.author", approve: "appliance_catalog.approve" },
  construction_recipe: { author: "product_catalog.author", approve: "product_catalog.approve" },
  product: { author: "product_catalog.author", approve: "product_catalog.approve" },
  material_catalog: { author: "material_catalog.author", approve: "material_catalog.approve" },
  finish_catalog: { author: "finish_catalog.author", approve: "finish_catalog.approve" },
  hardware_catalog: { author: "hardware_catalog.author", approve: "hardware_catalog.approve" },
  appliance_catalog: { author: "appliance_catalog.author", approve: "appliance_catalog.approve" },
  product_catalog: { author: "product_catalog.author", approve: "product_catalog.approve" },
  hettich_dataset: { author: "hettich.author", approve: "hettich.approve" },
  pricing_standard: { author: "pricing_standard.author", approve: "pricing_standard.approve" },
  quotation_policy: { author: "quotation_policy.author", approve: "quotation_policy.approve" },
};

/** Content that needs more than `reference.read`: the PricingStandard's rates and rules are internal cost data. */
const CONTENT_ACTION: Partial<Readonly<Record<ReferenceType, PermissionAction>>> = { pricing_standard: "output.read.cost" };

export function toVersion(type: ReferenceType, r: VersionRow): ReferenceVersion {
  return {
    type, id: r.id, entityId: r.entity_id, entityCode: r.entity_code, versionNumber: r.version_number, versionLabel: r.version_label, status: r.status,
    dataClassification: r.data_classification, source: r.source, sourceRef: r.source_ref, changeReason: r.change_reason, contentHash: r.content_hash, rowVersion: r.row_version,
    createdBy: r.created_by, createdAt: iso(r.created_at), submittedBy: r.submitted_by, submittedAt: iso(r.submitted_at), approvedBy: r.approved_by, approvedAt: iso(r.approved_at),
    effectiveFrom: iso(r.effective_from), lockedBy: r.locked_by, lockedAt: iso(r.locked_at), supersededBy: r.superseded_by, supersededAt: iso(r.superseded_at),
  };
}

function toEntity(type: ReferenceType, r: EntityRow): ReferenceEntity {
  const summaries = r.versions.map((v) => ({ id: v.id, versionNumber: v.version_number, versionLabel: v.version_label, status: v.status }));
  return {
    type, id: r.id, code: r.code, createdAt: iso(r.created_at), versionCount: r.version_count,
    latestVersion: summaries[0] ?? null,
    usableVersions: summaries.filter((v) => v.status === "APPROVED" || v.status === "LOCKED"),
  };
}

/**
 * Reference-data read API (M6 G1). Read-only: every statement is a SELECT in a READ ONLY transaction under RLS
 * (internal members with `reference.read`, own organization). Lifecycle statuses are returned exactly; nothing is
 * collapsed, defaulted or chosen as "latest" on the caller's behalf — `usableVersions` lists the APPROVED / LOCKED
 * candidates for an exact pin.
 */
@Injectable()
export class ReferenceDataService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork, @Inject(CursorCodec) private readonly cursors: CursorCodec) {}

  types(): ReferenceTypeList {
    return { items: REFERENCE_TYPES.map((type) => ({ type, authorAction: ACTIONS[type].author, approveAction: ACTIONS[type].approve, contentAction: CONTENT_ACTION[type] ?? null })) };
  }

  entities(scope: RequestScope, type: ReferenceType, q: EntityListQuery) {
    return this.uow.run(scope, { action: "reference.read", readOnly: true }, (tx) => keysetList(tx, {
      codec: this.cursors, collection: `reference:${type}:entities:${q.code ?? "*"}`, orgId: scope.org.orgId, sort: SORTS.codeAsc, query: q, firstParam: 2,
      fetch: (t, page, params) => repo.entities(t, type, q.code ?? null, page, params), key: (r) => r.code, id: (r) => r.id, map: (r) => toEntity(type, r),
    }));
  }

  versions(scope: RequestScope, type: ReferenceType, q: VersionListQuery) {
    const statuses = q.status ?? null;
    const filter = `${q.entityCode ?? "*"}:${q.entityId ?? "*"}:${statuses?.join(",") ?? "*"}`;
    // One entity: newest version number first. Across entities: newest created first.
    const oneEntity = q.entityCode !== undefined || q.entityId !== undefined;
    const sort = oneEntity ? SORTS.versionNumberDesc : SORTS.newestFirst;
    return this.uow.run(scope, { action: "reference.read", readOnly: true }, (tx) => keysetList(tx, {
      codec: this.cursors, collection: `reference:${type}:versions:${filter}`, orgId: scope.org.orgId, sort, query: q, firstParam: 4,
      fetch: (t, page, params) => repo.versions(t, type, { entityCode: q.entityCode ?? null, entityId: q.entityId ?? null, statuses }, page, params),
      key: (r) => (oneEntity ? r.version_number : r.created_at), id: (r) => r.id, map: (r) => toVersion(type, r),
    }));
  }

  version(scope: RequestScope, type: ReferenceType, id: string): Promise<StoredResponse> {
    const contentAction = CONTENT_ACTION[type];
    return this.uow.run(scope, { action: "reference.read", readOnly: true }, async (tx) => {
      const row = await repo.version(tx, type, id);
      if (row === null) throw new ApiProblem("NOT_FOUND");
      if (contentAction !== undefined && !scope.org.permissions.has(contentAction)) throw new ApiProblem("PERMISSION_DENIED", `reading this content needs ${contentAction}`);
      const { children, counts } = await repo.children(tx, type, id);
      const body: ReferenceVersionDetail = { ...toVersion(type, row), content: row.content, children, counts };
      return { status: 200, body, headers: { etag: versionEtag(row.id, row.row_version) } };
    });
  }

  hettich(scope: RequestScope, kind: "articles" | "calculation-rules", versionId: string, q: PageQuery | ArticleListQuery) {
    const category = "category" in q ? q.category ?? null : null;
    return this.uow.run(scope, { action: "reference.read", readOnly: true }, async (tx) => {
      if ((await repo.version(tx, "hettich_dataset", versionId)) === null) throw new ApiProblem("NOT_FOUND");
      return keysetList(tx, {
        codec: this.cursors, collection: `reference:hettich:${versionId}:${kind}:${category ?? "*"}`, orgId: scope.org.orgId, sort: SORTS.positionAsc, query: q, firstParam: 3,
        fetch: (t, page, params) => repo.hettichRows(t, kind === "articles" ? "hettich_article" : "hettich_calculation_rule", versionId, category, page, params),
        key: (r) => r.position, id: (r) => r.id, map: (r) => r.r,
      });
    });
  }
}
