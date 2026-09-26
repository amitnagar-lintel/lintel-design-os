import { Module } from "@nestjs/common";
import { OutputsController } from "./outputs.controller.js";
import { OutputsService } from "./outputs.service.js";

@Module({ controllers: [OutputsController], providers: [OutputsService] })
export class OutputsModule {}
