import { Module } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { RoleGuard } from './role.guard';

@Module({
  providers: [PermissionService, RoleGuard],
  exports: [PermissionService, RoleGuard],
})
export class PermissionModule {}
