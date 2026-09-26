import { Controller, Get, Inject, Param } from "@nestjs/common";
import type { z } from "zod";
import type { RequestScope } from "../../common/auth/context.js";
import { AuthenticatedOnly, Scope } from "../../common/auth/decorators.js";
import { ApiDoc } from "../../common/http/openapi.js";
import { SchemaPipe } from "../../common/http/schema.pipe.js";
import { Uuid } from "../../common/http/schemas.js";
import { ModelPreviewResponse } from "./model-preview.schemas.js";
import { ModelPreviewService } from "./model-preview.service.js";
import { z as zod } from "zod";

const VersionId = zod.strictObject({ versionId: Uuid });

/** The engine-resolved model of one exact design version, for the 2D / 3D workspace. Read-only. */
@Controller()
export class ModelPreviewController {
  constructor(@Inject(ModelPreviewService) private readonly preview: ModelPreviewService) {}

  @ApiDoc({ summary: "The resolved model of exactly this design version (objects, geometry, runs, validation); nothing is persisted", responses: { 200: ModelPreviewResponse } })
  @Get("design-versions/:versionId/model") @AuthenticatedOnly()
  get(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionId, "params")) p: z.infer<typeof VersionId>) {
    return this.preview.preview(s, p.versionId);
  }
}
