import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { roomToRows } from "@lintel/persistence";
import type { RequestScope } from "../../common/auth/context.js";
import type { Tx } from "../../common/db/tx.js";
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
import { projectsRepository } from "../../infrastructure/persistence/projects.repository.js";
import type { RoomRevisionRow, RoomRow } from "../../infrastructure/persistence/rooms.repository.js";
import { roomsRepository as repo } from "../../infrastructure/persistence/rooms.repository.js";
import type { RevisionResponse, RoomCreate, RoomResponse, RoomUpdate, SurveyInput } from "./rooms.schemas.js";

export const toRevision = (r: RoomRevisionRow): RevisionResponse => ({
  id: r.id, roomId: r.room_id, revisionNumber: r.revision_number, lengthMm: r.length_mm, widthMm: r.width_mm, heightMm: r.height_mm,
  wallThicknessMm: r.wall_thickness_mm, source: r.source, surveyedBy: r.surveyed_by, surveyedAt: iso(r.surveyed_at), contentHash: r.content_hash,
});
const toRoom = (r: RoomRow, latest: RoomRevisionRow | null): RoomResponse => ({
  id: r.id, projectId: r.project_id, name: r.name, roomType: r.room_type, createdAt: iso(r.created_at), latestRevision: latest === null ? null : toRevision(latest),
});

/** Rooms and their survey revisions. Revisions are insert-only: a new survey is a new revision. */
@Injectable()
export class RoomsService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(CursorCodec) private readonly cursors: CursorCodec,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  private async addRevision(tx: Tx, scope: RequestScope, room: RoomRow, s: SurveyInput): Promise<RoomRevisionRow> {
    const number = await repo.nextRevisionNumber(tx, room.id);
    const id = randomUUID();
    // The survey content hash is the persistence mapping's (dimensions only), so engine-side and API agree.
    const { revision } = roomToRows(
      { id: room.id, projectId: room.project_id, name: room.name, type: room.room_type, length: s.lengthMm, width: s.widthMm, height: s.heightMm, wallThickness: s.wallThicknessMm },
      { revisionId: id, revisionNumber: number, source: s.source, surveyedBy: scope.principal.userId, surveyedAt: s.surveyedAt ?? "" },
      { orgId: scope.org.orgId },
    );
    const row = await repo.insertRevision(tx, { ...revision, surveyed_at: s.surveyedAt ?? null });
    if (row === null) throw new ApiProblem("INTERNAL");
    return row;
  }

  create(scope: RequestScope, projectId: string, req: IdempotentRequest, b: RoomCreate) {
    return this.uow.run(scope, { action: "room.survey.write" }, (tx) => this.idempotency.forRequest(tx, scope, "room.create", req, b, async () => {
      if ((await projectsRepository.get(tx, projectId)) === null) throw new ApiProblem("NOT_FOUND");
      const room = await repo.insert(tx, { org_id: scope.org.orgId, project_id: projectId, name: b.name, room_type: b.roomType });
      if (room === null) throw new ApiProblem("INTERNAL");
      const latest = b.initialSurvey === undefined ? null : await this.addRevision(tx, scope, room, b.initialSurvey);
      return { status: 201, body: toRoom(room, latest), headers: { etag: recordEtag("room", room), location: `/api/v1/rooms/${room.id}` } };
    }));
  }

  get(scope: RequestScope, id: string): Promise<StoredResponse> {
    return this.uow.run(scope, { readOnly: true }, async (tx) => {
      const room = await repo.get(tx, id);
      if (room === null) throw new ApiProblem("NOT_FOUND");
      return { status: 200, body: toRoom(room, await repo.latestRevision(tx, id)), headers: { etag: recordEtag("room", room) } };
    });
  }

  update(scope: RequestScope, id: string, ifMatch: string | undefined, b: RoomUpdate): Promise<StoredResponse> {
    return this.uow.run(scope, { action: "room.survey.write" }, async (tx) => {
      const room = await repo.get(tx, id, true);
      if (room === null) throw new ApiProblem("NOT_FOUND");
      assertWritable({ ifMatch, currentEtag: recordEtag("room", room) });
      const next = await repo.rename(tx, id, b.name);
      if (next === null) throw new ApiProblem("NOT_FOUND");
      return { status: 200, body: toRoom(next, await repo.latestRevision(tx, id)), headers: { etag: recordEtag("room", next) } };
    });
  }

  list(scope: RequestScope, projectId: string, q: PageQuery) {
    return this.uow.run(scope, { readOnly: true }, async (tx) => {
      if ((await projectsRepository.get(tx, projectId)) === null) throw new ApiProblem("NOT_FOUND");
      return keysetList(tx, {
        codec: this.cursors, collection: `projects/${projectId}/rooms`, orgId: scope.org.orgId, sort: SORTS.newestFirst, query: q, firstParam: 2,
        fetch: (t, page, params) => repo.list(t, projectId, page, params), key: (r) => r.created_at, id: (r) => r.id, map: (r) => toRoom(r, null),
      });
    });
  }

  /** A new immutable survey revision (numbered under a lock on the room, so numbers never collide). */
  revise(scope: RequestScope, roomId: string, req: IdempotentRequest, b: SurveyInput) {
    return this.uow.run(scope, { action: "room.survey.write" }, (tx) => this.idempotency.forRequest(tx, scope, "room_revision.create", req, b, async () => {
      const room = await repo.get(tx, roomId, true);
      if (room === null) throw new ApiProblem("NOT_FOUND");
      const rev = await this.addRevision(tx, scope, room, b);
      return { status: 201, body: toRevision(rev), headers: { location: `/api/v1/room-revisions/${rev.id}` } };
    }));
  }

  revision(scope: RequestScope, id: string) {
    return this.uow.run(scope, { readOnly: true }, async (tx) => {
      const r = await repo.revision(tx, id);
      if (r === null) throw new ApiProblem("NOT_FOUND");
      return toRevision(r);
    });
  }

  revisions(scope: RequestScope, roomId: string, q: PageQuery) {
    return this.uow.run(scope, { readOnly: true }, async (tx) => {
      if ((await repo.get(tx, roomId)) === null) throw new ApiProblem("NOT_FOUND");
      return keysetList(tx, {
        codec: this.cursors, collection: `rooms/${roomId}/revisions`, orgId: scope.org.orgId, sort: SORTS.revisionNumberDesc, query: q, firstParam: 2,
        fetch: (t, page, params) => repo.revisions(t, roomId, page, params), key: (r) => r.revision_number, id: (r) => r.id, map: toRevision,
      });
    });
  }
}
