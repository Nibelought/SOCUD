import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmbedDocumentHandler } from './embed-document.handler';
import { EmbeddingBackfillService } from './embedding-backfill.service';
import { EmbeddingClient } from './embedding.client';
import { EmbeddingModelGuard } from './embedding-model.guard';
import { EmbeddingWorker } from './embedding.worker';
import { QueueService } from './queue.service';

@Module({
  imports: [PrismaModule],
  providers: [
    QueueService,
    EmbeddingClient,
    EmbeddingModelGuard,
    EmbedDocumentHandler,
    EmbeddingWorker,
    EmbeddingBackfillService,
  ],
  exports: [
    QueueService,
    EmbeddingClient,
    EmbeddingModelGuard,
    EmbeddingBackfillService,
    EmbedDocumentHandler,
  ],
})
export class QueueModule {}
