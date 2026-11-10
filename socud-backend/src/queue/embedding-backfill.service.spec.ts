import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  createConfigServiceMock,
  createPrismaServiceMock,
} from '../test-utils/mocks';
import { EmbedDocumentHandler } from './embed-document.handler';
import { EmbeddingBackfillService } from './embedding-backfill.service';
import { QueueService } from './queue.service';

const m = (fn: unknown) => fn as jest.Mock;

describe('EmbeddingBackfillService', () => {
  let prisma: jest.Mocked<PrismaService>;
  let queue: { enabled: boolean; enqueueEmbedDocument: jest.Mock };
  let handler: { handle: jest.Mock };
  let service: EmbeddingBackfillService;

  beforeEach(() => {
    prisma = createPrismaServiceMock();
    queue = {
      enabled: true,
      enqueueEmbedDocument: jest.fn().mockResolvedValue(true),
    };
    handler = { handle: jest.fn().mockResolvedValue({ status: 'done' }) };
    service = new EmbeddingBackfillService(
      prisma,
      queue as unknown as QueueService,
      handler as unknown as EmbedDocumentHandler,
      createConfigServiceMock() as unknown as ConfigService,
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
});
