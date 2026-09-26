import { Module } from "@nestjs/common";
import { ReferenceDataController } from "./reference-data.controller.js";
import { ReferenceDataService } from "./reference-data.service.js";

@Module({ controllers: [ReferenceDataController], providers: [ReferenceDataService] })
export class ReferenceDataModule {}
