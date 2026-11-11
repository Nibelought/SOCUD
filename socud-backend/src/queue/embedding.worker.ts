import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { EmbedDocumentHandler } from './embed-document.handler';
import { EmbeddingError } from './embedding.client';
import {
  EMBED_DOCUMENT_JOB,
  EMBEDDINGS_QUEUE,
  type EmbedDocumentJobData,
} from './queue.constants';
import { isQueueEnabled } from './queue.service';
import { DEFAULT_REDIS_URL, createWorkerConnection } from './redis';

/**
 * Runs the BullMQ consumer inside the API process. Disabled in tests and when
 * QUEUE_WORKER_ENABLED=false (e.g. the backfill script, or an API-only replica).
 */
@Injectable()
export class EmbeddingWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmbeddingWorker.name);
  private connection?: IORedis;
  private worker?: Worker<EmbedDocumentJobData>;

  constructor(
    private readonly config: ConfigService,
    private readonly handler: EmbedDocumentHandler,
  ) {}

  onModuleInit(): void {
    const workerFlag = this.config.get<boolean | undefined>(
      'QUEUE_WORKER_ENABLED',
    );
    if (!isQueueEnabled(this.config) || workerFlag === false) return;

    const url = this.config.get<string>('REDIS_URL') ?? DEFAULT_REDIS_URL;
    this.connection = createWorkerConnection(url, this.logger);
    this.worker = new Worker<EmbedDocumentJobData>(
      EMBEDDINGS_QUEUE,
      (job) => this.process(job),
      {
        connection: this.connection,
        // The local MLX model serves one request at a time anyway; a hosted API (EMBEDDING_PROVIDER=api)
        // takes several, see README "Using a hosted embedding API".
        concurrency: this.config.get<number>('EMBED_CONCURRENCY') ?? 1,
      },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.warn(
        `Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
      ),
    );
    this.worker.on('error', () => undefined); // connection errors are logged by the connection
    this.logger.log('Embedding worker started');
  }

  async onModuleDestroy(): Promise<void> {
    const worker = this.worker;
    const connection = this.connection;
    this.worker = undefined;
    this.connection = undefined;
    await worker?.close().catch(() => undefined);
    connection?.disconnect();
  }

  async process(job: Job<EmbedDocumentJobData>): Promise<unknown> {
    if (job.name !== EMBED_DOCUMENT_JOB) {
      throw new UnrecoverableError(`Unknown job ${job.name}`);
    }
    try {
      return await this.handler.handle(job.data);
    } catch (err) {
      // Permanent provider errors (422, 401/402, wrong dimension, ...) must not burn the retry budget.
      if (err instanceof EmbeddingError && !err.retryable) {
        throw new UnrecoverableError(err.message);
      }
      throw err;
    }
  }
}
