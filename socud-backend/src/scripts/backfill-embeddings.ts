/**
 * Re-embeds every published document whose embeddings are missing or outdated (after the
 * 768 -> 1024 dimension switch, or after Redis lost jobs). Idempotent.
 *
 *   npm run backfill:embeddings            # enqueue jobs; a running API/worker processes them
 *   npm run backfill:embeddings -- --inline  # embed in this process (no Redis needed)
 *
 * Production (after `npm run build`): node dist/scripts/backfill-embeddings.js [--inline]
 */
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { validateEnv } from '../config/env.validation';
import { PrismaModule } from '../prisma/prisma.module';
import { EmbeddingBackfillService } from '../queue/embedding-backfill.service';
import { QueueModule } from '../queue/queue.module';

// This process only produces jobs: never consume them or start the periodic reconcile here.
// Set before the module decorator below runs, because ConfigModule reads the environment then.
process.env.QUEUE_WORKER_ENABLED = 'false';
process.env.EMBED_RECONCILE_INTERVAL_MS = '0';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    QueueModule,
  ],
})
class BackfillModule {}

async function main(): Promise<void> {
  const inline = process.argv.includes('--inline');
  const app = await NestFactory.createApplicationContext(BackfillModule, {
    logger: ['log', 'warn', 'error'],
  });
  const logger = new Logger('BackfillEmbeddings');
  try {
    const backfill = app.get(EmbeddingBackfillService);
    const result = inline
      ? await backfill.embedMissingInline()
      : await backfill.enqueueMissing();
    logger.log(
      `Done: ${result.found} document(s) needed embeddings, ${result.scheduled} ${inline ? 'embedded' : 'enqueued'}`,
    );
    if (result.scheduled < result.found) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
