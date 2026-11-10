import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmbedDocumentHandler } from './embed-document.handler';
import { EmbeddingBackfillService } from './embedding-backfill.service';
import { EmbeddingClient } from './embedding.client';
import { EmbeddingWorker } from './embedding.worker';
import { QueueService } from './queue.service';

@Module({
  imports: [PrismaModule],
  providers: [
    QueueService,
    EmbeddingClient,
    EmbedDocumentHandler,
    EmbeddingWorker,
    EmbeddingBackfillService,
  ],
  exports: [
    QueueService,
    EmbeddingClient,
    EmbeddingBackfillService,
    EmbedDocumentHandler,
  ],
})
export class QueueModule {}
