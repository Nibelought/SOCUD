import { Module } from '@nestjs/common';
import { HocuspocusService } from './hocuspocus.service';
import { PermissionModule } from '../permission/permission.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, PermissionModule],
  providers: [HocuspocusService],
})
export class HocuspocusModule {}
