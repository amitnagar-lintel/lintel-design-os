import { Controller, Get, Inject, Param, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { RequestScope } from "../../common/auth/context.js";
import { AnyIdentity, AuthenticatedOnly, Public, Scope } from "../../common/auth/decorators.js";
import { SchemaPipe } from "../../common/http/schema.pipe.js";
import { FileIdParam, FileUrlQuery } from "./outputs.schemas.js";
import { FilesService } from "./files.service.js";
import { ApiDoc } from "../../common/http/openapi.js";
import { FileUrlResponse } from "./outputs.schemas.js";

/**
 * Stored output files. A signed URL is issued to a caller who may read the file (RLS: internal production readers, or
 * a client for a file of an issued drawing); the URL is then the only credential for its bytes, for 300 seconds.
 */
@Controller()
@AnyIdentity()
export class FilesController {
  constructor(@Inject(FilesService) private readonly files: FilesService) {}

  @ApiDoc({ summary: "A 300-second signed URL for a readable file", responses: { 200: FileUrlResponse } })
  @Get("files/:fileId/url") @AuthenticatedOnly()
  url(@Scope() s: RequestScope, @Param(new SchemaPipe(FileIdParam, "params")) p: z.infer<typeof FileIdParam>, @Query(new SchemaPipe(FileUrlQuery, "query")) q: z.infer<typeof FileUrlQuery>) {
    return this.files.signedUrl(s, p.fileId, q.disposition);
  }

  /** Serves a signed URL: the signature, expiry and key are verified; no session is used. */
  @ApiDoc({ summary: "The bytes behind a signed file URL", responses: { 200: "binary" } })
  @Get("file-content/*") @Public()
  async content(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const file = await this.files.content(req.url);
    void reply.header("content-type", file.contentType);
    void reply.header("content-disposition", file.disposition);
    void reply.header("digest", file.checksum.replace(/^sha256:/, "sha-256=:").concat(":"));
    void reply.header("cache-control", "private, no-store");
    void reply.header("x-content-type-options", "nosniff");
    return Buffer.from(file.bytes);
  }
}
