import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { chunkHtml } from '../pipeline/chunker';
import { EMBED_BATCH_SIZE, EmbeddingClient } from './embedding.client';
import type { EmbedDocumentJobData } from './queue.constants';

export type EmbedDocumentResult =
  | { status: 'missing' | 'stale' }
  | { status: 'done'; embedded: number };

/** Pgvector text literal: `[0.1,0.2,...]`. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

/**
 * Body of the `embed-document` job. Independent of BullMQ so it can be unit-tested and reused by
 * the inline backfill.
 *
 * Idempotent and safe against stale jobs:
 *  - a job whose `version` is not the document's current `publishedVersion` does nothing;
 *  - only chunks with a NULL embedding are embedded, so a retry resumes where it stopped;
 *  - each batch is written with an UPDATE by chunk id, which affects nothing for chunks a newer
 *    publish has deleted in the meantime.
 * Errors from the AI worker propagate (EmbeddingError) so the queue can retry.
 */
@Injectable()
export class EmbedDocumentHandler {
  private readonly logger = new Logger(EmbedDocumentHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingClient,
  ) {}

  async handle(data: EmbedDocumentJobData): Promise<EmbedDocumentResult> {
    const { documentId, version } = data;

    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { publishedVersion: true },
    });
    if (!doc) return { status: 'missing' };
    if (doc.publishedVersion !== version) return { status: 'stale' };

    if (
      data.rebuildChunks &&
      !(await this.rebuildChunks(documentId, version))
    ) {
      return { status: 'stale' };
    }

    const pending = await this.prisma.$queryRaw<
      { id: string; textContent: string }[]
    >`
      SELECT "id", "textContent" FROM "DocumentChunk"
      WHERE "documentId" = ${documentId} AND "embedding" IS NULL
      ORDER BY "chunkIndex"
    `;

    let embedded = 0;
    for (let i = 0; i < pending.length; i += EMBED_BATCH_SIZE) {
      const batch = pending.slice(i, i + EMBED_BATCH_SIZE);
      const vectors = await this.embeddings.embedBatch(
        batch.map((chunk) => chunk.textContent),
        false,
      );
      await this.storeBatch(
        documentId,
        batch.map((chunk) => chunk.id),
        vectors,
      );
      embedded += batch.length;
    }

    // Only mark the version as embedded if it is still the current one.
    const marked = await this.prisma.document.updateMany({
      where: { id: documentId, publishedVersion: version },
      data: { embeddedVersion: version },
    });
    if (marked.count === 0) return { status: 'stale' };

    this.logger.log(
      `[Embed] doc ${documentId} v${version}: embedded ${embedded} chunk(s)`,
    );
    return { status: 'done', embedded };
  }

  /** pgvector columns are `Unsupported` in Prisma, so vectors are written with raw SQL. */
  private async storeBatch(
    documentId: string,
    ids: string[],
    vectors: number[][],
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "DocumentChunk" AS c
      SET "embedding" = v.vec::vector
      FROM unnest(${ids}::text[], ${vectors.map(toVectorLiteral)}::text[]) AS v(id, vec)
      WHERE c."id" = v.id AND c."documentId" = ${documentId}
    `;
  }

  /**
   * Re-creates the chunks from the published HTML (legacy documents, new chunker, model switch).
   * Keeps the existing rows (and their embeddings) when the chunk texts are unchanged.
   * Returns false when the document moved on to another version meanwhile.
   */
  private async rebuildChunks(
    documentId: string,
    version: number,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Row lock: serializes with a concurrent Publish of the same document.
      const rows = await tx.$queryRaw<{ publishedVersion: number }[]>`
        SELECT "publishedVersion" FROM "Document"
        WHERE "id" = ${documentId} FOR UPDATE
      `;
      if (rows.length === 0 || rows[0].publishedVersion !== version) {
        return false;
      }
      const doc = await tx.document.findUnique({
        where: { id: documentId },
        select: { contentHtml: true },
      });
      const texts = chunkHtml(doc?.contentHtml ?? '');

      const existing = await tx.documentChunk.findMany({
        where: { documentId },
        orderBy: { chunkIndex: 'asc' },
        select: { textContent: true },
      });
      const unchanged =
        existing.length === texts.length &&
        existing.every((chunk, i) => chunk.textContent === texts[i]);
      if (unchanged) return true;

      await tx.documentChunk.deleteMany({ where: { documentId } });
      if (texts.length > 0) {
        await tx.documentChunk.createMany({
          data: texts.map((textContent, chunkIndex) => ({
            documentId,
            chunkIndex,
            textContent,
          })),
        });
      }
      return true;
    });
  }
}
