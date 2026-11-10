import { Module } from '@nestjs/common';
import { DocumentService } from './document.service';
import { DocumentController } from './document.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PermissionModule } from '../permission/permission.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { QueueModule } from '../queue/queue.module';
import { SearchModule } from '../search/search.module';

@Module({
  imports: [
    PrismaModule,
    PermissionModule,
    QueueModule,
    PipelineModule,
    SearchModule,
  ],
  controllers: [DocumentController],
  providers: [DocumentService],
  exports: [DocumentService], // КРИТИЧЕСКИ ВАЖНО: Делает сервис публичным для других модулей
})
export class DocumentModule {}
