/**
 * TEST-ONLY routes that exercise the API foundation (context propagation, error mapping, ETags, idempotency,
 * pagination) against the real database. They are never part of the application module.
 */
import { Body, Controller, Get, Headers, Inject, Injectable, Module, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { RequestScope } from "../../src/common/auth/context.js";
import { AuthenticatedOnly, ClientRoute, RequiresAction, Scope } from "../../src/common/auth/decorators.js";
import { UnitOfWork } from "../../src/common/db/unit-of-work.js";
import { ApiProblem } from "../../src/common/errors/api-problem.js";
import { assertWritable, recordEtag, versionEtag } from "../../src/common/http/etag.js";
import type { LifecycleState } from "../../src/common/http/etag.js";
import { CursorCodec, keysetClause, SORTS, toPage } from "../../src/common/http/pagination.js";
import { respond } from "../../src/common/http/respond.js";
import { SchemaPipe } from "../../src/common/http/schema.pipe.js";
import { PageQuery, Uuid } from "../../src/common/http/schemas.js";
import { IdempotencyService, requestHash, requireIdempotencyKey } from "../../src/common/idempotency/idempotency.service.js";

const Rename = z.strictObject({ name: z.string().min(1).max(200) });
const Reason = z.strictObject({ changeReason: z.string().min(1).max(200) });
const Invite = z.strictObject({ name: z.string().min(1), holdMs: z.number().int().min(0).max(10_000).optional() });
const ErrorKind = z.enum(["not-found", "division", "lifecycle", "duplicate"]);
const Id = z.strictObject({ id: Uuid });
const OptionalId = z.strictObject({ id: Uuid.optional() });

const CLIENT_COLUMNS = "id::text, org_id::text, client_code, name, contact, ops_client_ref, ops_lead_ref, created_at";

@Injectable()
class ProbeService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(CursorCodec) private readonly cursors: CursorCodec,
  ) {}

  context(scope: RequestScope) {
    return this.uow.run(scope, { action: "client.read", readOnly: true }, (tx) => tx.one(`
      SELECT current_user::text AS "currentUser", session_user::text AS "sessionUser", current_setting('request.jwt.claims') AS claims,
             design_os.current_org_id()::text AS "orgId", current_setting('design_os.request_id') AS "requestId"`));
  }

  rlsInsert(scope: RequestScope) {
    // No API-level action check on purpose: the database (RLS) is the final boundary.
    return this.uow.run(scope, {}, (tx) => tx.one("INSERT INTO design_os.client (org_id, client_code, name) VALUES ($1, $2, 'RLS probe') RETURNING id::text", [scope.org.orgId, `RLS_${scope.requestId.slice(0, 8)}`]));
  }

  error(scope: RequestScope, kind: z.infer<typeof ErrorKind>, id: string | undefined) {
    return this.uow.run(scope, {}, async (tx) => {
      switch (kind) {
        case "not-found": return tx.query("SELECT design_os.transition('design', gen_random_uuid(), 'SUBMIT', 'probe', NULL)");
        case "division": return tx.query("SELECT 1 / 0");
        case "lifecycle": return tx.query("SELECT design_os.transition('construction_standard', $1, 'APPROVE', 'probe', 'sha256:x')", [id]);
        case "duplicate":
          await tx.query("INSERT INTO design_os.client (org_id, client_code, name) VALUES ($1, 'DUP', 'a')", [scope.org.orgId]);
          return tx.query("INSERT INTO design_os.client (org_id, client_code, name) VALUES ($1, 'DUP', 'b')", [scope.org.orgId]);
      }
    });
  }

  async client(scope: RequestScope, id: string) {
    return this.uow.run(scope, { action: "client.read", readOnly: true }, async (tx) => {
      const row = await tx.maybeOne(`SELECT ${CLIENT_COLUMNS} FROM design_os.client WHERE id = $1`, [id]);
      if (row === null) throw new ApiProblem("NOT_FOUND");
      return { row, etag: recordEtag("client", row) };
    });
  }

  rename(scope: RequestScope, id: string, ifMatch: string | undefined, name: string) {
    return this.uow.run(scope, { action: "client.write" }, async (tx) => {
      const row = await tx.maybeOne(`SELECT ${CLIENT_COLUMNS} FROM design_os.client WHERE id = $1 FOR UPDATE`, [id]);
      if (row === null) throw new ApiProblem("NOT_FOUND");
      assertWritable({ ifMatch, currentEtag: recordEtag("client", row) });
      const updated = await tx.one(`UPDATE design_os.client SET name = $2 WHERE id = $1 RETURNING ${CLIENT_COLUMNS}`, [id, name]);
      return { row: updated, etag: recordEtag("client", updated) };
    });
  }

  reviseStandard(scope: RequestScope, id: string, ifMatch: string | undefined, changeReason: string) {
    return this.uow.run(scope, { action: "construction_standard.author" }, async (tx) => {
      const v = await tx.maybeOne<{ id: string; row_version: number; status: LifecycleState }>(
        "SELECT id::text, row_version, status::text FROM design_os.construction_standard_version WHERE id = $1 FOR UPDATE", [id]);
      if (v === null) throw new ApiProblem("NOT_FOUND");
      assertWritable({ ifMatch, currentEtag: versionEtag(v.id, v.row_version), lifecycle: v.status });
      const u = await tx.maybeOne<{ row_version: number }>(
        "UPDATE design_os.construction_standard_version SET change_reason = $3 WHERE id = $1 AND row_version = $2 RETURNING row_version", [id, v.row_version, changeReason]);
      if (u === null) throw new ApiProblem("STALE_VERSION");
      return { etag: versionEtag(v.id, u.row_version) };
    });
  }

  clients(scope: RequestScope, q: PageQuery) {
    return this.uow.run(scope, { action: "client.read", readOnly: true }, async (tx) => {
      const after = q.cursor === undefined ? undefined : this.cursors.decode(q.cursor, "clients", scope.org.orgId, SORTS.newestFirst);
      const k = keysetClause(SORTS.newestFirst, 1, after !== undefined);
      const params = after === undefined ? [q.limit + 1] : [after.key, after.id, q.limit + 1];
      const rows = await tx.query<{ id: string; created_at: string; name: string }>(
        `SELECT id::text, created_at, name FROM design_os.client WHERE ${k.where} ${k.orderLimit}`, params);
      return toPage(rows, q.limit, (r) => this.cursors.encode("clients", scope.org.orgId, SORTS.newestFirst, { key: r.created_at, id: r.id }), (r) => ({ id: r.id, name: r.name }));
    });
  }

  invite(scope: RequestScope, key: string, operation: string, body: z.infer<typeof Invite>) {
    const hash = requestHash({ method: "POST", operation, userId: scope.principal.userId, orgId: scope.org.orgId, params: {}, query: {}, body });
    return this.uow.run(scope, { action: "client.write" }, (tx) =>
      this.idempotency.run(tx, { scope: "client_contact.invite", key, requestHash: hash }, async () => {
        const row = await tx.one<{ id: string }>("INSERT INTO design_os.client (org_id, client_code, name) VALUES ($1, $2, $3) RETURNING id::text",
          [scope.org.orgId, `INV_${key.slice(0, 20)}`, body.name]);
        if (body.holdMs !== undefined) await tx.query("SELECT pg_sleep($1::float / 1000)", [body.holdMs]);
        return { status: 201, body: { clientId: row.id, name: body.name }, headers: { location: `/api/v1/clients/${row.id}` } };
      }));
  }
}

@Controller("__probe")
class ProbeController {
  constructor(@Inject(ProbeService) private readonly probe: ProbeService) {}

  @Get("context") @RequiresAction("client.read")
  context(@Scope() s: RequestScope) { return this.probe.context(s); }

  @Get("internal") @AuthenticatedOnly()
  internal() { return { ok: true }; }

  @Get("portal") @AuthenticatedOnly() @ClientRoute()
  portal() { return { ok: true }; }

  @Get("write-guarded") @RequiresAction("client.write")
  writeGuarded() { return { ok: true }; }

  @Post("rls-insert") @AuthenticatedOnly()
  rlsInsert(@Scope() s: RequestScope) { return this.probe.rlsInsert(s); }

  @Get("errors/:kind") @AuthenticatedOnly()
  error(@Scope() s: RequestScope, @Param("kind", new SchemaPipe(ErrorKind, "params")) kind: z.infer<typeof ErrorKind>, @Query(new SchemaPipe(OptionalId, "query")) q: z.infer<typeof OptionalId>) {
    return this.probe.error(s, kind, q.id);
  }

  @Get("clients") @RequiresAction("client.read")
  clients(@Scope() s: RequestScope, @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) { return this.probe.clients(s, q); }

  @Get("clients/:id") @RequiresAction("client.read")
  async client(@Scope() s: RequestScope, @Param(new SchemaPipe(Id, "params")) p: z.infer<typeof Id>, @Res({ passthrough: true }) reply: FastifyReply) {
    const r = await this.probe.client(s, p.id);
    void reply.header("etag", r.etag);
    return r.row;
  }

  @Patch("clients/:id") @RequiresAction("client.write")
  async rename(@Scope() s: RequestScope, @Param(new SchemaPipe(Id, "params")) p: z.infer<typeof Id>, @Headers("if-match") ifMatch: string | undefined,
    @Body(new SchemaPipe(Rename, "body")) b: z.infer<typeof Rename>, @Res({ passthrough: true }) reply: FastifyReply) {
    const r = await this.probe.rename(s, p.id, ifMatch, b.name);
    void reply.header("etag", r.etag);
    return r.row;
  }

  @Patch("construction-standards/:id") @RequiresAction("construction_standard.author")
  async revise(@Scope() s: RequestScope, @Param(new SchemaPipe(Id, "params")) p: z.infer<typeof Id>, @Headers("if-match") ifMatch: string | undefined,
    @Body(new SchemaPipe(Reason, "body")) b: z.infer<typeof Reason>, @Res({ passthrough: true }) reply: FastifyReply) {
    const r = await this.probe.reviseStandard(s, p.id, ifMatch, b.changeReason);
    void reply.header("etag", r.etag);
    return r;
  }

  @Post("invites") @RequiresAction("client.write")
  async invite(@Scope() s: RequestScope, @Req() req: FastifyRequest, @Body(new SchemaPipe(Invite, "body")) b: z.infer<typeof Invite>, @Res({ passthrough: true }) reply: FastifyReply) {
    const key = requireIdempotencyKey(req.headers["idempotency-key"]);
    return respond(reply, await this.probe.invite(s, key, `POST ${req.routeOptions.url ?? ""}`, b));
  }
}

@Module({ controllers: [ProbeController], providers: [ProbeService] })
export class ProbeModule {}
