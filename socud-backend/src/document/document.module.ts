import { Module } from '@nestjs/common';
import { DocumentService } from './document.service';
import { DocumentController } from './document.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [PrismaModule, QueueModule],
  controllers: [DocumentController],
  providers: [DocumentService],
  exports: [DocumentService], // КРИТИЧЕСКИ ВАЖНО: Делает сервис публичным для других модулей
})
export class DocumentModule {}
