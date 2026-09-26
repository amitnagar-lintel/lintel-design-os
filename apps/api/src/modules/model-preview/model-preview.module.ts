import { Module } from "@nestjs/common";
import { ModelPreviewController } from "./model-preview.controller.js";
import { ModelPreviewService } from "./model-preview.service.js";

@Module({ controllers: [ModelPreviewController], providers: [ModelPreviewService] })
export class ModelPreviewModule {}
