import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PermissionModule } from '../permission/permission.module';
import { QueueModule } from '../queue/queue.module';
import { SearchService } from './search.service';

@Module({
  imports: [PrismaModule, PermissionModule, QueueModule],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
