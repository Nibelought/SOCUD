import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config'; // Гарантированная загрузка .env файла до инициализации класса

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    // 1. Создаем пул подключений через нативный JS-драйвер PostgreSQL
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    
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