import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import {
  EMBED_DOCUMENT_JOB,
  EMBED_JOB_ATTEMPTS,
  EMBED_JOB_BACKOFF_MS,
  EMBEDDINGS_QUEUE,
  type EmbedDocumentJobData,
} from './queue.constants';
import { DEFAULT_REDIS_URL, createProducerConnection } from './redis';

/** Upper bound for adding a job; Publish must not hang on a sick Redis. */
const ENQUEUE_TIMEOUT_MS = 3_000;

export function isQueueEnabled(config: ConfigService): boolean {
  const flag = config.get<boolean | undefined>('QUEUE_ENABLED');
  if (flag !== undefined) return flag;
  return config.get<string>('NODE_ENV') !== 'test';
}

/**
 * Producer side of the BullMQ embedding queue.
 *
 * `enqueueEmbedDocument` never throws: if Redis is unreachable the failure is logged and `false`
 * is returned. Nothing is lost, because the embedding backfill/reconcile finds every document
 * whose `embeddedVersion` is behind its `publishedVersion` and enqueues it again.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private connection?: IORedis;
  private queue?: Queue<EmbedDocumentJobData>;

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return isQueueEnabled(this.config);
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Queue disabled (QUEUE_ENABLED=false or test env)');
      return;
    }
    const url = this.config.get<string>('REDIS_URL') ?? DEFAULT_REDIS_URL;
    this.connection = createProducerConnection(url, this.logger);
    this.queue = new Queue<EmbedDocumentJobData>(EMBEDDINGS_QUEUE, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: EMBED_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: EMBED_JOB_BACKOFF_MS },
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
    // Queue emits 'error' for connection problems; without a listener it would crash the process.
    this.queue.on('error', () => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    const queue = this.queue;
    const connection = this.connection;
    this.queue = undefined;
    this.connection = undefined;
    await queue?.close().catch(() => undefined);
    connection?.disconnect();
  }

  /**
   * Enqueues (idempotently: the job id is documentId + version) the embedding of a document
   * version. Returns whether a job exists afterwards.
   */
  async enqueueEmbedDocument(data: EmbedDocumentJobData): Promise<boolean> {
    const queue = this.queue;
    if (!queue) return false;
    const jobId = `embed-${data.documentId}-${data.version}`;
    try {
      await this.withTimeout(this.addJob(queue, jobId, data));
      return true;
    } catch (err) {
      this.logger.warn(
        `Could not enqueue embedding of doc ${data.documentId} v${data.version}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  private async addJob(
    queue: Queue<EmbedDocumentJobData>,
    jobId: string,
    data: EmbedDocumentJobData,
  ): Promise<void> {
    // A permanently failed job with the same id would make `add` a silent no-op; replace it.
    const existing = await queue.getJob(jobId);
    if (existing && (await existing.isFailed())) await existing.remove();
    await queue.add(EMBED_DOCUMENT_JOB, data, { jobId });
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(`Redis did not answer within ${ENQUEUE_TIMEOUT_MS} ms`),
          ),
        ENQUEUE_TIMEOUT_MS,
      );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }
}
