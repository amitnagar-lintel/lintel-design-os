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
import type { ClientRow } from "../../infrastructure/persistence/clients.repository.js";
import { clientsRepository as repo } from "../../infrastructure/persistence/clients.repository.js";
import type { ClientCreate, ClientResponse, ClientUpdate } from "./clients.schemas.js";

export function toClient(r: ClientRow): ClientResponse {
  return { id: r.id, clientCode: r.client_code, name: r.name, contact: (r.contact ?? null) as Record<string, string> | null, opsClientRef: r.ops_client_ref, opsLeadRef: r.ops_lead_ref, createdAt: iso(r.created_at) };
}

/** Clients (the project's commercial counterparty). Creation is idempotent by the unique client code. */
@Injectable()
export class ClientsService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork, @Inject(CursorCodec) private readonly cursors: CursorCodec) {}

  create(scope: RequestScope, b: ClientCreate): Promise<StoredResponse> {
    return this.uow.run(scope, { action: "client.write" }, async (tx) => {
      const row = await repo.insert(tx, { org_id: scope.org.orgId, client_code: b.clientCode, name: b.name, contact: b.contact ?? null, ops_client_ref: b.opsClientRef ?? null, ops_lead_ref: b.opsLeadRef ?? null });
      if (row === null) throw new ApiProblem("INTERNAL");
      return { status: 201, body: toClient(row), headers: { etag: recordEtag("client", row), location: `/api/v1/clients/${row.id}` } };
    });
  }

  get(scope: RequestScope, id: string): Promise<StoredResponse> {
    return this.uow.run(scope, { action: "client.read", readOnly: true }, async (tx) => {
      const row = await repo.get(tx, id);
      if (row === null) throw new ApiProblem("NOT_FOUND");
      return { status: 200, body: toClient(row), headers: { etag: recordEtag("client", row) } };
    });
  }

  update(scope: RequestScope, id: string, ifMatch: string | undefined, b: ClientUpdate): Promise<StoredResponse> {
    return this.uow.run(scope, { action: "client.write" }, async (tx) => {
      const row = await repo.get(tx, id, true);
      if (row === null) throw new ApiProblem("NOT_FOUND");
      assertWritable({ ifMatch, currentEtag: recordEtag("client", row) });
      const next = await repo.update(tx, id, {
        name: b.name ?? row.name,
        contact: b.contact === undefined ? row.contact : b.contact,
        ops_client_ref: b.opsClientRef === undefined ? row.ops_client_ref : b.opsClientRef,
        ops_lead_ref: b.opsLeadRef === undefined ? row.ops_lead_ref : b.opsLeadRef,
      });
      if (next === null) throw new ApiProblem("NOT_FOUND");
      return { status: 200, body: toClient(next), headers: { etag: recordEtag("client", next) } };
    });
  }

  list(scope: RequestScope, q: PageQuery) {
    return this.uow.run(scope, { action: "client.read", readOnly: true }, (tx) => keysetList(tx, {
      codec: this.cursors, collection: "clients", orgId: scope.org.orgId, sort: SORTS.newestFirst, query: q, firstParam: 1,
      fetch: (t, page, params) => repo.list(t, page, params), key: (r) => r.created_at, id: (r) => r.id, map: toClient,
    }));
  }
}
