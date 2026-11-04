import { Module } from '@nestjs/common';
import { HocuspocusService } from './hocuspocus.service';
import { DocumentModule } from '../document/document.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  // Импортируем модули, чтобы использовать их экспортированные сервисы
  imports: [PrismaModule, DocumentModule],
  providers: [HocuspocusService],
})
export class HocuspocusModule {}
