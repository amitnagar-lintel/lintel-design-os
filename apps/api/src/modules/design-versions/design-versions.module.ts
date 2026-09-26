import { Module } from "@nestjs/common";
import { DesignObjectsService } from "./design-objects.service.js";
import { DesignVersionsController } from "./design-versions.controller.js";
import { DesignVersionsService } from "./design-versions.service.js";
import { ValidationService } from "./validation.service.js";

@Module({ controllers: [DesignVersionsController], providers: [DesignVersionsService, DesignObjectsService, ValidationService] })
export class DesignVersionsModule {}
