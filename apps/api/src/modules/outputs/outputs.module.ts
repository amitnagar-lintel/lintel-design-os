import { Module } from "@nestjs/common";
import { FilesController } from "./files.controller.js";
import { FilesService } from "./files.service.js";
import { IssuesController } from "./issues.controller.js";
import { IssuesService } from "./issues.service.js";
import { OutputsController } from "./outputs.controller.js";
import { OutputsService } from "./outputs.service.js";

@Module({ controllers: [OutputsController, FilesController, IssuesController], providers: [OutputsService, FilesService, IssuesService] })
export class OutputsModule {}
