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
    // 1. Create a connection pool with the native JS PostgreSQL driver
    const pool = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
    });

    // 2. Wrap the pool in a Prisma 7 compatible adapter
    const adapter = new PrismaPg(pool);

    // 3. Pass the adapter to the PrismaClient base class
    super({ adapter });

    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    // Release the native pool on shutdown
    await this.pool.end();
  }
}
