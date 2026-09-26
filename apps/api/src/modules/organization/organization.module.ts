import { Module } from "@nestjs/common";
import { MyInvitationsController, OrganizationController } from "./organization.controller.js";
import { OrganizationService } from "./organization.service.js";

@Module({ controllers: [OrganizationController, MyInvitationsController], providers: [OrganizationService] })
export class OrganizationModule {}
