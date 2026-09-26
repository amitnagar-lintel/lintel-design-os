import { Inject, Injectable } from "@nestjs/common";
import type { RequestScope } from "../../common/auth/context.js";
import { UnitOfWork } from "../../common/db/unit-of-work.js";
import { ApiProblem } from "../../common/errors/api-problem.js";
import { assertWritable, recordEtag } from "../../common/http/etag.js";
import { iso } from "../../common/http/format.js";
import { keysetList } from "../../common/http/list.js";
import { CursorCodec, SORTS } from "../../common/http/pagination.js";
import type { IdempotentRequest } from "../../common/http/request.js";
import type { PageQuery } from "../../common/http/schemas.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import type { StoredResponse } from "../../common/idempotency/idempotency.service.js";
import type { DesignRow } from "../../infrastructure/persistence/designs.repository.js";
import { designsRepository as repo } from "../../infrastructure/persistence/designs.repository.js";
import { projectsRepository } from "../../infrastructure/persistence/projects.repository.js";
import { roomsRepository } from "../../infrastructure/persistence/rooms.repository.js";
import type { DesignCreate, DesignResponse, DesignUpdate } from "./designs.schemas.js";

export const toDesign = (r: DesignRow): DesignResponse => ({ id: r.id, projectId: r.project_id, roomId: r.room_id, name: r.name, status: r.status, createdAt: iso(r.created_at) });

@Injectable()
export class DesignsService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(CursorCodec) private readonly cursors: CursorCodec,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  /** The design is associated with the room's project (never a client-supplied project). */
  create(scope: RequestScope, roomId: string, req: IdempotentRequest, b: DesignCreate) {
    return this.uow.run(scope, { action: "design_version.author" }, (tx) => this.idempotency.forRequest(tx, scope, "design.create", req, b, async () => {
      const room = await roomsRepository.get(tx, roomId);
      if (room === null) throw new ApiProblem("NOT_FOUND");
      const row = await repo.insert(tx, { org_id: scope.org.orgId, project_id: room.project_id, room_id: room.id, name: b.name });
      if (row === null) throw new ApiProblem("INTERNAL");
      return { status: 201, body: toDesign(row), headers: { etag: recordEtag("design", row), location: `/api/v1/designs/${row.id}` } };
    }));
  }

  get(scope: RequestScope, id: string): Promise<StoredResponse> {
    return this.uow.run(scope, { readOnly: true }, async (tx) => {
      const row = await repo.get(tx, id);
      if (row === null) throw new ApiProblem("NOT_FOUND");
      return { status: 200, body: toDesign(row), headers: { etag: recordEtag("design", row) } };
    });
  }

  update(scope: RequestScope, id: string, ifMatch: string | undefined, b: DesignUpdate): Promise<StoredResponse> {
    return this.uow.run(scope, { action: "design_version.author" }, async (tx) => {
      const row = await repo.get(tx, id, true);
      if (row === null) throw new ApiProblem("NOT_FOUND");
      assertWritable({ ifMatch, currentEtag: recordEtag("design", row) });
      const next = await repo.update(tx, id, { name: b.name ?? row.name, status: b.status ?? row.status });
      if (next === null) throw new ApiProblem("NOT_FOUND");
      return { status: 200, body: toDesign(next), headers: { etag: recordEtag("design", next) } };
    });
  }

  list(scope: RequestScope, by: { readonly column: "project_id" | "room_id"; readonly value: string }, q: PageQuery) {
    return this.uow.run(scope, { readOnly: true }, async (tx) => {
      const parent = by.column === "project_id" ? await projectsRepository.get(tx, by.value) : await roomsRepository.get(tx, by.value);
      if (parent === null) throw new ApiProblem("NOT_FOUND");
      return keysetList(tx, {
        codec: this.cursors, collection: `${by.column}/${by.value}/designs`, orgId: scope.org.orgId, sort: SORTS.newestFirst, query: q, firstParam: 2,
        fetch: (t, page, params) => repo.list(t, by, page, params), key: (r) => r.created_at, id: (r) => r.id, map: toDesign,
      });
    });
  }
}
