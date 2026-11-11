import { Module } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { RoleGuard } from './role.guard';
import { SystemAdminGuard } from './system-admin.guard';

@Module({
  providers: [PermissionService, RoleGuard, SystemAdminGuard],
  exports: [PermissionService, RoleGuard, SystemAdminGuard],
})
export class PermissionModule {}
