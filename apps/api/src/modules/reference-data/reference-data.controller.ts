import { Controller, Get, Inject, Param, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { z } from "zod";
import type { RequestScope } from "../../common/auth/context.js";
import { RequiresAction, Scope } from "../../common/auth/decorators.js";
import { ApiDoc } from "../../common/http/openapi.js";
import { send } from "../../common/http/request.js";
import { SchemaPipe } from "../../common/http/schema.pipe.js";
import { Page, PageQuery } from "../../common/http/schemas.js";
import {
  ArticleListQuery, EntityListQuery, HettichArticle, HettichRule, HettichVersionParams, ReferenceEntity, ReferenceTypeList, ReferenceVersion, ReferenceVersionDetail, TypeParam, VersionListQuery, VersionParams,
} from "./reference-data.schemas.js";
import { ReferenceDataService } from "./reference-data.service.js";

/**
 * Read-only reference data (M6 G1): standards, catalog items, catalogs, Hettich datasets, PricingStandard and
 * QuotationPolicy versions. There is no write route: reference data is entered only through the reviewed intake
 * tool and changes lifecycle only through design_os.transition().
 */
@Controller("reference-data")
export class ReferenceDataController {
  constructor(@Inject(ReferenceDataService) private readonly data: ReferenceDataService) {}

  @ApiDoc({ summary: "The reference-data types and the actions that author / approve them", responses: { 200: ReferenceTypeList } })
  @Get() @RequiresAction("reference.read")
  types() {
    return this.data.types();
  }

  @ApiDoc({ summary: "Hettich articles of a dataset version, by position", responses: { 200: Page(HettichArticle) } })
  @Get("hettich_dataset/versions/:versionId/articles") @RequiresAction("reference.read")
  articles(@Scope() s: RequestScope, @Param(new SchemaPipe(HettichVersionParams, "params")) p: z.infer<typeof HettichVersionParams>,
    @Query(new SchemaPipe(ArticleListQuery, "query")) q: ArticleListQuery) {
    return this.data.hettich(s, "articles", p.versionId, q);
  }

  @ApiDoc({ summary: "Hettich calculation rules of a dataset version, by position", responses: { 200: Page(HettichRule) } })
  @Get("hettich_dataset/versions/:versionId/calculation-rules") @RequiresAction("reference.read")
  rules(@Scope() s: RequestScope, @Param(new SchemaPipe(HettichVersionParams, "params")) p: z.infer<typeof HettichVersionParams>,
    @Query(new SchemaPipe(PageQuery, "query")) q: PageQuery) {
    return this.data.hettich(s, "calculation-rules", p.versionId, q);
  }

  @ApiDoc({ summary: "Entities of a reference-data type with their versions", responses: { 200: Page(ReferenceEntity) } })
  @Get(":type/entities") @RequiresAction("reference.read")
  entities(@Scope() s: RequestScope, @Param(new SchemaPipe(TypeParam, "params")) p: z.infer<typeof TypeParam>, @Query(new SchemaPipe(EntityListQuery, "query")) q: EntityListQuery) {
    return this.data.entities(s, p.type, q);
  }

  @ApiDoc({ summary: "Versions of a reference-data type (filter by entity and exact lifecycle status)", responses: { 200: Page(ReferenceVersion) } })
  @Get(":type/versions") @RequiresAction("reference.read")
  versions(@Scope() s: RequestScope, @Param(new SchemaPipe(TypeParam, "params")) p: z.infer<typeof TypeParam>, @Query(new SchemaPipe(VersionListQuery, "query")) q: VersionListQuery) {
    return this.data.versions(s, p.type, q);
  }

  @ApiDoc({ summary: "One exact reference-data version with its content and provenance", responses: { 200: ReferenceVersionDetail } })
  @Get(":type/versions/:versionId") @RequiresAction("reference.read")
  async version(@Scope() s: RequestScope, @Param(new SchemaPipe(VersionParams, "params")) p: z.infer<typeof VersionParams>, @Res({ passthrough: true }) reply: FastifyReply) {
    return send(reply, await this.data.version(s, p.type, p.versionId));
  }
}
