import { Module } from '@nestjs/common';
import { HocuspocusService } from './hocuspocus.service';
import { PermissionModule } from '../permission/permission.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, PermissionModule, PipelineModule],
  providers: [HocuspocusService],
})
export class HocuspocusModule {}
