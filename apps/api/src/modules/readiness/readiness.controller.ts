import { Controller, Get, Inject, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { RequestScope } from "../../common/auth/context.js";
import { Public, RequiresAction, Scope } from "../../common/auth/decorators.js";
import { ApiDoc } from "../../common/http/openapi.js";
import { SchemaPipe } from "../../common/http/schema.pipe.js";
import { Page } from "../../common/http/schemas.js";
import { AuditChainResponse, AuditEntry, AuditQuery, ReadinessReport, ReadyResponse } from "./readiness.schemas.js";
import { ReadinessService } from "./readiness.service.js";

/** Public readiness for load balancers and deploy automation: 200 ready / 503 not ready, no details. */
@Controller("ready")
export class ReadyController {
  constructor(@Inject(ReadinessService) private readonly readiness: ReadinessService) {}

  @ApiDoc({ summary: "Readiness: database, migrations and engine manifest (200 ready / 503 not ready)", responses: { 200: ReadyResponse } })
  @Get() @Public()
  async get(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<ReadyResponse> {
    const r = await this.readiness.ready(req.id);
    void reply.status(r.ok ? 200 : 503);
    return r.body;
  }
}

/** The organization's deployment / pilot gate report and the audit trail (audit.read). Read-only. */
@Controller()
export class ReadinessController {
  constructor(@Inject(ReadinessService) private readonly readiness: ReadinessService) {}

  @ApiDoc({ summary: "Readiness report: migrations, audit chain, required production data and its dependencies (BLOCKING / WARNING / INFO)", responses: { 200: ReadinessReport } })
  @Get("readiness") @RequiresAction("audit.read")
  report(@Scope() s: RequestScope) {
    return this.readiness.readiness(s);
  }

  @ApiDoc({ summary: "The organization's audit trail, newest first (filter by table, row, actor, time)", responses: { 200: Page(AuditEntry) } })
  @Get("audit") @RequiresAction("audit.read")
  audit(@Scope() s: RequestScope, @Query(new SchemaPipe(AuditQuery, "query")) q: AuditQuery) {
    return this.readiness.audit(s, q);
  }

  @ApiDoc({ summary: "Verify the organization's audit hash chain", responses: { 200: AuditChainResponse } })
  @Get("audit/verify") @RequiresAction("audit.read")
  verify(@Scope() s: RequestScope) {
    return this.readiness.auditChain(s);
  }
}
