import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    // 1. Создаем пул подключений через нативный JS-драйвер PostgreSQL
    const pool = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
    });

    // 2. Оборачиваем пул драйвера в совместимый с Prisma 7 адаптер
    const adapter = new PrismaPg(pool);

    // 3. Передаем адаптер в родительский класс PrismaClient
    super({ adapter });

    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    // Обязательно освобождаем ресурсы нативного пула при остановке сервера
    await this.pool.end();
  }
}
