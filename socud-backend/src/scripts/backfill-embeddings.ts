/**
 * Re-embeds every published document whose embeddings are missing or outdated (after the
 * 768 -> 1024 dimension switch, or after Redis lost jobs). Idempotent.
 *
 *   npm run backfill:embeddings            # enqueue jobs; a running API/worker processes them
 *   npm run backfill:embeddings -- --inline  # embed in this process (no Redis needed)
 *   npm run backfill:embeddings -- --reembed-mismatched
 *       # additionally re-embed chunks whose vector came from another model than the active one
 *       # (EMBEDDING_PROVIDER / EMBEDDING_API_MODEL / EMBEDDING_MODEL_ID). Combine with --inline.
 *
 * --reembed-mismatched is idempotent and resumable: old vectors are overwritten in place, and a
 * run that stops half-way is simply repeated (chunks already on the active model are skipped).
 *
 * Production (after `npm run build`): node dist/scripts/backfill-embeddings.js [--inline] [--reembed-mismatched]
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
  const reembedMismatched = process.argv.includes('--reembed-mismatched');
  const app = await NestFactory.createApplicationContext(BackfillModule, {
    logger: ['log', 'warn', 'error'],
  });
  const logger = new Logger('BackfillEmbeddings');
  try {
    const backfill = app.get(EmbeddingBackfillService);
    const options = { reembedMismatched };
    const result = inline
      ? await backfill.embedMissingInline(options)
      : await backfill.enqueueMissing(options);
    logger.log(
      `Done: ${result.found} document(s) needed embeddings${reembedMismatched ? ' (including other-model chunks)' : ''}, ${result.scheduled} ${inline ? 'embedded' : 'enqueued'}`,
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
