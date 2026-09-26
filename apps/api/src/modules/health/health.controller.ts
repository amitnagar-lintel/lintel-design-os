import { Controller, Get } from "@nestjs/common";
import { z } from "zod";
import { Public } from "../../common/auth/decorators.js";
import { ApiDoc } from "../../common/http/openapi.js";

/** Liveness only: no database access, no data. */
@Controller("health")
export class HealthController {
  @Get()
  @Public()
  @ApiDoc({ summary: "Liveness", responses: { 200: z.strictObject({ status: z.literal("ok") }) } })
  get(): { status: "ok" } {
    return { status: "ok" };
  }
}
