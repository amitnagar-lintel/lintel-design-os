import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { RequestScope } from "../../common/auth/context.js";
import { UnitOfWork } from "../../common/db/unit-of-work.js";
import { ApiProblem } from "../../common/errors/api-problem.js";
import { assertWritable, recordEtag } from "../../common/http/etag.js";
import { iso } from "../../common/http/format.js";
import { keysetList } from "../../common/http/list.js";
import { CursorCodec, SORTS } from "../../common/http/pagination.js";
import type { PageQuery } from "../../common/http/schemas.js";
import type { StoredResponse } from "../../common/idempotency/idempotency.service.js";
import type { ProjectMemberRow, ProjectRow } from "../../infrastructure/persistence/projects.repository.js";
import { projectsRepository as repo } from "../../infrastructure/persistence/projects.repository.js";
import type { MemberAssign, MemberResponse, MemberRevoke, ProjectCreate, ProjectResponse, ProjectUpdate } from "./projects.schemas.js";

export function toProject(r: ProjectRow): ProjectResponse {
  return {
    id: r.id, clientId: r.client_id, projectCode: r.project_code, name: r.name, siteAddress: (r.site_address ?? null) as Record<string, string> | null,
    status: r.status, currency: "INR", unitSystem: "MM", opsProjectRef: r.ops_project_ref, createdAt: iso(r.created_at),
  };
}
const toMember = (m: ProjectMemberRow): MemberResponse => ({
  projectId: m.project_id, userId: m.user_id, role: m.role as MemberResponse["role"], clientContactId: m.client_contact_id, grantedBy: m.granted_by, grantedAt: iso(m.granted_at),
});

/**
 * Projects and project membership. Visibility is RLS (`can_access_project`): a project of another tenant, or one the
 * caller is not assigned to (without `project.read_all`), is indistinguishable from a missing one (404).
 */
@Injectable()
export class ProjectsService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork, @Inject(CursorCodec) private readonly cursors: CursorCodec) {}

  create(scope: RequestScope, b: ProjectCreate): Promise<StoredResponse> {
    return this.uow.run(scope, { action: "project.write" }, async (tx) => {
      const row = await repo.insert(tx, { id: randomUUID(), org_id: scope.org.orgId, client_id: b.clientId, project_code: b.projectCode, name: b.name, site_address: b.siteAddress ?? null, ops_project_ref: b.opsProjectRef ?? null });
      if (row === null) throw new ApiProblem("INTERNAL");
      return { status: 201, body: toProject(row), headers: { etag: recordEtag("project", row), location: `/api/v1/projects/${row.id}` } };
    });
  }

  get(scope: RequestScope, id: string): Promise<StoredResponse> {
    return this.uow.run(scope, { readOnly: true }, async (tx) => {
      const row = await repo.get(tx, id);
      if (row === null) throw new ApiProblem("NOT_FOUND");
      return { status: 200, body: toProject(row), headers: { etag: recordEtag("project", row) } };
    });
  }

  update(scope: RequestScope, id: string, ifMatch: string | undefined, b: ProjectUpdate): Promise<StoredResponse> {
    return this.uow.run(scope, { action: "project.write" }, async (tx) => {
      const row = await repo.get(tx, id, true);
      if (row === null) throw new ApiProblem("NOT_FOUND");
      assertWritable({ ifMatch, currentEtag: recordEtag("project", row) });
      const next = await repo.update(tx, id, {
        name: b.name ?? row.name,
        site_address: b.siteAddress === undefined ? row.site_address : b.siteAddress,
        ops_project_ref: b.opsProjectRef === undefined ? row.ops_project_ref : b.opsProjectRef,
      });
      if (next === null) throw new ApiProblem("NOT_FOUND");
      return { status: 200, body: toProject(next), headers: { etag: recordEtag("project", next) } };
    });
  }

  list(scope: RequestScope, q: PageQuery) {
    return this.uow.run(scope, { readOnly: true }, (tx) => keysetList(tx, {
      codec: this.cursors, collection: "projects", orgId: scope.org.orgId, sort: SORTS.newestFirst, query: q, firstParam: 1,
      fetch: (t, page, params) => repo.list(t, page, params), key: (r) => r.created_at, id: (r) => r.id, map: toProject,
    }));
  }

  members(scope: RequestScope, projectId: string) {
    return this.uow.run(scope, { readOnly: true }, async (tx) => {
      if ((await repo.get(tx, projectId)) === null) throw new ApiProblem("NOT_FOUND");
      return { items: (await repo.members(tx, projectId)).map(toMember) };
    });
  }

  /** Idempotent by its natural key (project, user, role): a repeat is 409 DUPLICATE_RESOURCE. */
  assign(scope: RequestScope, projectId: string, b: MemberAssign): Promise<StoredResponse> {
    return this.uow.run(scope, { action: "project_members.assign" }, async (tx) => {
      if ((await repo.get(tx, projectId)) === null) throw new ApiProblem("NOT_FOUND");
      const row = await repo.addMember(tx, { org_id: scope.org.orgId, project_id: projectId, user_id: b.userId, role: b.role, client_contact_id: b.clientContactId ?? null, granted_by: scope.principal.userId });
      if (row === null) throw new ApiProblem("INTERNAL");
      return { status: 201, body: toMember(row) };
    });
  }

  /** Revocation deletes the membership row (the audit chain keeps who, when and why). */
  revoke(scope: RequestScope, projectId: string, b: MemberRevoke): Promise<StoredResponse> {
    return this.uow.run(scope, { action: "project_members.assign", reason: b.reason }, async (tx) => {
      if ((await repo.get(tx, projectId)) === null) throw new ApiProblem("NOT_FOUND");
      const row = await repo.removeMember(tx, projectId, b.userId, b.role);
      if (row === null) throw new ApiProblem("NOT_FOUND");
      return { status: 200, body: { revoked: toMember(row) } };
    });
  }
}
