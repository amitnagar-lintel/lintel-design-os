import { Module } from "@nestjs/common";
import { ReadinessController, ReadyController } from "./readiness.controller.js";
import { ReadinessService } from "./readiness.service.js";

@Module({ controllers: [ReadyController, ReadinessController], providers: [ReadinessService] })
export class ReadinessModule {}
