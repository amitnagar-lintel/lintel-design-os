import { Module } from "@nestjs/common";
import { DesignsController } from "./designs.controller.js";
import { DesignsService } from "./designs.service.js";

@Module({ controllers: [DesignsController], providers: [DesignsService] })
export class DesignsModule {}
