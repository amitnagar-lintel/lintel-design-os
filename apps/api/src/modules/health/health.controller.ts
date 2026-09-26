import { Controller, Get } from "@nestjs/common";
import { Public } from "../../common/auth/decorators.js";

/** Liveness only: no database access, no data. */
@Controller("health")
export class HealthController {
  @Get()
  @Public()
  get(): { status: "ok" } {
    return { status: "ok" };
  }
}
