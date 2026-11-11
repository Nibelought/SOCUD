import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  createConfigServiceMock,
  createPrismaServiceMock,
} from '../test-utils/mocks';
import { EmbedDocumentHandler } from './embed-document.handler';
import { EmbeddingBackfillService } from './embedding-backfill.service';
import { EmbeddingClient } from './embedding.client';
import { EmbeddingModelGuard } from './embedding-model.guard';
import { QueueService } from './queue.service';

const m = (fn: unknown) => fn as jest.Mock;

describe('EmbeddingBackfillService', () => {
  let prisma: jest.Mocked<PrismaService>;
  let queue: { enabled: boolean; enqueueEmbedDocument: jest.Mock };
  let handler: { handle: jest.Mock };
  let modelGuard: { invalidate: jest.Mock };
  let service: EmbeddingBackfillService;

  beforeEach(() => {
    prisma = createPrismaServiceMock();
    queue = {
      enabled: true,
      enqueueEmbedDocument: jest.fn().mockResolvedValue(true),
    };
    handler = { handle: jest.fn().mockResolvedValue({ status: 'done' }) };
    modelGuard = { invalidate: jest.fn() };
    service = new EmbeddingBackfillService(
      prisma,
      queue as unknown as QueueService,
      handler as unknown as EmbedDocumentHandler,
      createConfigServiceMock() as unknown as ConfigService,
      { modelId: 'new-model@1024' } as unknown as EmbeddingClient,
      modelGuard as unknown as EmbeddingModelGuard,
    );
  });

  it('selects only published documents with missing or outdated embeddings', async () => {
    m(prisma.$queryRaw).mockResolvedValue([]);
    await service.enqueueMissing();
    const [strings] = m(prisma.$queryRaw).mock.calls[0] as [
      TemplateStringsArray,
    ];
    const sql = strings.join('?');
    expect(sql).toContain('"contentHtml" IS NOT NULL');
    expect(sql).toContain(
      '"embeddedVersion" IS NULL OR "embeddedVersion" < "publishedVersion"',
    );
  });

  it('enqueues a rebuilding job per document, paging through all of them', async () => {
    m(prisma.$queryRaw)
      .mockResolvedValueOnce([
        { id: 'a', version: 0 },
        { id: 'b', version: 3 },
      ])
      .mockResolvedValueOnce([{ id: 'c', version: 1 }])
      .mockResolvedValueOnce([]);

    const result = await service.enqueueMissing();

    expect(result).toEqual({ found: 3, scheduled: 3 });
    expect(queue.enqueueEmbedDocument.mock.calls.map((c) => c[0])).toEqual([
      { documentId: 'a', version: 0, rebuildChunks: true },
      { documentId: 'b', version: 3, rebuildChunks: true },
      { documentId: 'c', version: 1, rebuildChunks: true },
    ]);
    // Keyset pagination: the second page starts after the last id of the first.
    expect(m(prisma.$queryRaw).mock.calls[1][1]).toBe('b');
  });

  it('reports documents it could not schedule (Redis down)', async () => {
    m(prisma.$queryRaw)
      .mockResolvedValueOnce([{ id: 'a', version: 1 }])
      .mockResolvedValueOnce([]);
    queue.enqueueEmbedDocument.mockResolvedValue(false);
    expect(await service.enqueueMissing()).toEqual({ found: 1, scheduled: 0 });
  });

  it('is idempotent: nothing pending means nothing enqueued', async () => {
    m(prisma.$queryRaw).mockResolvedValue([]);
    expect(await service.enqueueMissing()).toEqual({ found: 0, scheduled: 0 });
    expect(queue.enqueueEmbedDocument).not.toHaveBeenCalled();
  });

  it('can embed inline without Redis and continues after a failing document', async () => {
    m(prisma.$queryRaw)
      .mockResolvedValueOnce([
        { id: 'a', version: 1 },
        { id: 'b', version: 1 },
      ])
      .mockResolvedValueOnce([]);
    handler.handle
      .mockRejectedValueOnce(new Error('worker down'))
      .mockResolvedValueOnce({ status: 'done' });

    const result = await service.embedMissingInline();

    expect(result).toEqual({ found: 2, scheduled: 1 });
    expect(queue.enqueueEmbedDocument).not.toHaveBeenCalled();
    expect(handler.handle).toHaveBeenCalledWith({
      documentId: 'b',
      version: 1,
      rebuildChunks: true,
    });
  });

  describe('--reembed-mismatched', () => {
    const sqlOf = (call: number) =>
      (m(prisma.$queryRaw).mock.calls[call] as [TemplateStringsArray])[0].join(
        '?',
      );

    it('also selects documents holding chunks embedded by another (or an unknown) model', async () => {
      m(prisma.$queryRaw).mockResolvedValue([]);
      await service.enqueueMissing({ reembedMismatched: true });

      const [, ...params] = m(prisma.$queryRaw).mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      const sql = sqlOf(0);
      // Still picks documents that are not embedded at all ...
      expect(sql).toContain('"embeddedVersion" IS NULL');
      // ... plus those with a vector from a different model; NULL model counts as the legacy one.
      expect(sql).toContain('EXISTS');
      expect(sql).toContain('c."embedding" IS NOT NULL');
      expect(sql).toContain('COALESCE(c."embeddingModel"');
      // legacy model for NULL rows, active model, keyset cursor, page size
      expect(params).toEqual([
        'qwen3-embedding-4b@1024',
        'new-model@1024',
        '',
        200,
      ]);
    });

    it('does not look at models without the flag (existing behaviour)', async () => {
      m(prisma.$queryRaw).mockResolvedValue([]);
      await service.enqueueMissing();
      expect(sqlOf(0)).not.toContain('embeddingModel');
    });

    it('passes the flag on to the queued jobs and the inline handler', async () => {
      m(prisma.$queryRaw)
        .mockResolvedValueOnce([{ id: 'a', version: 2 }])
        .mockResolvedValueOnce([]);
      await service.enqueueMissing({ reembedMismatched: true });
      expect(queue.enqueueEmbedDocument).toHaveBeenCalledWith({
        documentId: 'a',
        version: 2,
        rebuildChunks: true,
        reembedMismatched: true,
      });

      m(prisma.$queryRaw)
        .mockResolvedValueOnce([{ id: 'a', version: 2 }])
        .mockResolvedValueOnce([]);
      await service.embedMissingInline({ reembedMismatched: true });
      expect(handler.handle).toHaveBeenCalledWith({
        documentId: 'a',
        version: 2,
        rebuildChunks: true,
        reembedMismatched: true,
      });
    });

    it('is idempotent: once nothing mismatches, nothing is scheduled; the status cache is dropped after a run', async () => {
      m(prisma.$queryRaw)
        .mockResolvedValueOnce([{ id: 'a', version: 2 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      await service.embedMissingInline({ reembedMismatched: true });
      expect(modelGuard.invalidate).toHaveBeenCalledTimes(1);

      handler.handle.mockClear();
      expect(
        await service.embedMissingInline({ reembedMismatched: true }),
      ).toEqual({ found: 0, scheduled: 0 });
      expect(handler.handle).not.toHaveBeenCalled();
    });
  });
});
