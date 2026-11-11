import { Module } from '@nestjs/common';
import { PermissionModule } from '../permission/permission.module';
import { QueueModule } from '../queue/queue.module';
import { EmbeddingStatusController } from './embedding-status.controller';

@Module({
  imports: [PermissionModule, QueueModule],
  controllers: [EmbeddingStatusController],
})
export class AdminModule {}
