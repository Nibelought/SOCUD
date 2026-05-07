import { Module } from '@nestjs/common';
import { DocumentService } from './document.service';
import { DocumentController } from './document.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports:[PrismaModule],
  controllers: [DocumentController],
  providers: [DocumentService],
  exports: [DocumentService], // КРИТИЧЕСКИ ВАЖНО: Делает сервис публичным для других модулей
})
export class DocumentModule {}
