import { Module } from "@nestjs/common";
import { FilesController } from "./files.controller.js";
import { FilesService } from "./files.service.js";
import { OutputsController } from "./outputs.controller.js";
import { OutputsService } from "./outputs.service.js";

@Module({ controllers: [OutputsController, FilesController], providers: [OutputsService, FilesService] })
export class OutputsModule {}
