import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmbedDocumentHandler } from './embed-document.handler';
import { EmbeddingClient } from './embedding.client';
import {
  EmbeddingModelGuard,
  LEGACY_EMBEDDING_MODEL,
} from './embedding-model.guard';
import { QueueService } from './queue.service';

const PAGE_SIZE = 200;
const STARTUP_DELAY_MS = 10_000;
const DEFAULT_RECONCILE_INTERVAL_MS = 10 * 60_000;

export interface BackfillOptions {
  /**
   * Besides documents with missing/outdated embeddings, also pick documents that have chunks
   * embedded by another model than the active one (or an unknown/legacy one, which counts as
   * `LEGACY_EMBEDDING_MODEL`) and re-embed those chunks.
   */
  reembedMismatched?: boolean;
}

export interface BackfillResult {
  /** Published documents whose embeddings are missing or outdated. */
  found: number;
  /** Jobs enqueued (or already queued) / documents processed inline. */
  scheduled: number;
}

/**
 * Finds published documents whose chunks are not (fully) embedded for their current
 * `publishedVersion` and (re-)schedules them. Idempotent: embedded documents are skipped and job
 * ids are unique per document + version, so running it twice never duplicates work.
 *
 * Runs as a script (`npm run backfill:embeddings`), once shortly after API start, and then
 * periodically as a safety net for jobs that could not be enqueued (Redis down during Publish).
 */
@Injectable()
export class EmbeddingBackfillService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmbeddingBackfillService.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly handler: EmbedDocumentHandler,
    private readonly config: ConfigService,
    private readonly embeddings: EmbeddingClient,
    private readonly modelGuard: EmbeddingModelGuard,
  ) {}

  onModuleInit(): void {
    if (!this.queue.enabled) return;
    const interval =
      this.config.get<number>('EMBED_RECONCILE_INTERVAL_MS') ??
      DEFAULT_RECONCILE_INTERVAL_MS;
    if (interval <= 0) return;

    const run = () =>
      this.enqueueMissing().catch((err: unknown) =>
        this.logger.warn(
          `Embedding reconcile failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    const first = setTimeout(() => void run(), STARTUP_DELAY_MS);
    const periodic = setInterval(() => void run(), interval);
    first.unref();
    periodic.unref();
    this.timers.push(first, periodic);
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => {
      clearTimeout(t);
      clearInterval(t);
    });
    this.timers = [];
  }

  /** Enqueues an `embed-document` job (with chunk rebuild) for every document that needs one. */
  async enqueueMissing(options: BackfillOptions = {}): Promise<BackfillResult> {
    const reembedMismatched = options.reembedMismatched === true;
    return this.forEachPending(reembedMismatched, async (documentId, version) =>
      this.queue.enqueueEmbedDocument({
        documentId,
        version,
        rebuildChunks: true,
        ...(reembedMismatched ? { reembedMismatched } : {}),
      }),
    );
  }

  /** Same, but embeds in this process without Redis (needs only the AI worker). */
  async embedMissingInline(
    options: BackfillOptions = {},
  ): Promise<BackfillResult> {
    const reembedMismatched = options.reembedMismatched === true;
    return this.forEachPending(
      reembedMismatched,
      async (documentId, version) => {
        try {
          await this.handler.handle({
            documentId,
            version,
            rebuildChunks: true,
            ...(reembedMismatched ? { reembedMismatched } : {}),
          });
          return true;
        } catch (err) {
          this.logger.error(
            `Inline embedding of ${documentId} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return false;
        }
      },
    );
  }

  private async forEachPending(
    reembedMismatched: boolean,
    action: (documentId: string, version: number) => Promise<boolean>,
  ): Promise<BackfillResult> {
    if (this.running) return { found: 0, scheduled: 0 };
    this.running = true;
    try {
      const result: BackfillResult = { found: 0, scheduled: 0 };
      // Only read when needed: an unused id would just be a dead bind parameter.
      const activeModel = reembedMismatched ? this.embeddings.modelId : '';
      let cursor = '';
      for (;;) {
        const rows = reembedMismatched
          ? await this.prisma.$queryRaw<{ id: string; version: number }[]>`
              SELECT d."id", d."publishedVersion" AS "version" FROM "Document" d
              WHERE d."contentHtml" IS NOT NULL
                AND (d."embeddedVersion" IS NULL OR d."embeddedVersion" < d."publishedVersion"
                     OR EXISTS (
                       SELECT 1 FROM "DocumentChunk" c
                       WHERE c."documentId" = d."id" AND c."embedding" IS NOT NULL
                         AND COALESCE(c."embeddingModel", ${LEGACY_EMBEDDING_MODEL}) <> ${activeModel}
                     ))
                AND d."id" > ${cursor}
              ORDER BY d."id"
              LIMIT ${PAGE_SIZE}
            `
          : await this.prisma.$queryRaw<{ id: string; version: number }[]>`
              SELECT "id", "publishedVersion" AS "version" FROM "Document"
              WHERE "contentHtml" IS NOT NULL
                AND ("embeddedVersion" IS NULL OR "embeddedVersion" < "publishedVersion")
                AND "id" > ${cursor}
              ORDER BY "id"
              LIMIT ${PAGE_SIZE}
            `;
        if (rows.length === 0) break;
        for (const row of rows) {
          result.found++;
          if (await action(row.id, row.version)) result.scheduled++;
        }
        cursor = rows[rows.length - 1].id;
      }
      if (result.found > 0) {
        this.logger.log(
          `Embedding backfill: ${result.found} document(s) pending, ${result.scheduled} scheduled`,
        );
        // The stored-model counts changed (or will, once the jobs ran): do not serve a stale status.
        this.modelGuard.invalidate();
      }
      return result;
    } finally {
      this.running = false;
    }
  }
}
