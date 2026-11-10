import { PrismaService } from '../prisma/prisma.service';
import { createPrismaServiceMock } from '../test-utils/mocks';
import {
  EmbedDocumentHandler,
  toVectorLiteral,
} from './embed-document.handler';
import { EmbeddingClient, EmbeddingError } from './embedding.client';

const m = (fn: unknown) => fn as jest.Mock;
const DOC = 'doc-1';

describe('EmbedDocumentHandler', () => {
  let prisma: jest.Mocked<PrismaService>;
  let embeddings: { embedBatch: jest.Mock };
  let handler: EmbedDocumentHandler;

  const chunks = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `c${i}`,
      textContent: `text ${i}`,
    }));

  beforeEach(() => {
    prisma = createPrismaServiceMock();
    m(prisma.$transaction).mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(prisma),
    );
    m(prisma.document.findUnique).mockResolvedValue({ publishedVersion: 4 });
    m(prisma.document.updateMany).mockResolvedValue({ count: 1 });
    m(prisma.$executeRaw).mockResolvedValue(1);
    embeddings = {
      embedBatch: jest
        .fn()
        .mockImplementation((texts: string[]) =>
          Promise.resolve(texts.map(() => [0.1, 0.2])),
        ),
    };
    handler = new EmbedDocumentHandler(
      prisma,
      embeddings as unknown as EmbeddingClient,
    );
  });

  it('embeds pending chunks in batches of at most 32 and stores them with raw SQL', async () => {
    m(prisma.$queryRaw).mockResolvedValue(chunks(70));

    const result = await handler.handle({ documentId: DOC, version: 4 });

    expect(result).toEqual({ status: 'done', embedded: 70 });
    expect(embeddings.embedBatch.mock.calls.map((c) => c[0].length)).toEqual([
      32, 32, 6,
    ]);
    expect(embeddings.embedBatch.mock.calls.every((c) => c[1] === false)).toBe(
      true,
    );
    expect(m(prisma.$executeRaw)).toHaveBeenCalledTimes(3);
    const [strings, ids, vectors] = m(prisma.$executeRaw).mock.calls[0] as [
      TemplateStringsArray,
      string[],
      string[],
    ];
    expect(strings.join('?')).toContain('UPDATE "DocumentChunk"');
    expect(ids).toHaveLength(32);
    expect(vectors[0]).toBe('[0.1,0.2]');
    expect(m(prisma.document.updateMany)).toHaveBeenCalledWith({
      where: { id: DOC, publishedVersion: 4 },
      data: { embeddedVersion: 4 },
    });
  });

  it('is a no-op for a stale job (a newer version was published)', async () => {
    m(prisma.document.findUnique).mockResolvedValue({ publishedVersion: 5 });

    const result = await handler.handle({ documentId: DOC, version: 4 });

    expect(result).toEqual({ status: 'stale' });
    expect(m(prisma.$queryRaw)).not.toHaveBeenCalled();
    expect(embeddings.embedBatch).not.toHaveBeenCalled();
    expect(m(prisma.document.updateMany)).not.toHaveBeenCalled();
  });

  it('is a no-op for a deleted document', async () => {
    m(prisma.document.findUnique).mockResolvedValue(null);
    expect(await handler.handle({ documentId: DOC, version: 4 })).toEqual({
      status: 'missing',
    });
  });

  it('marks the version done without calling the worker when there is nothing to embed', async () => {
    m(prisma.$queryRaw).mockResolvedValue([]);

    const result = await handler.handle({ documentId: DOC, version: 4 });

    expect(result).toEqual({ status: 'done', embedded: 0 });
    expect(embeddings.embedBatch).not.toHaveBeenCalled();
    expect(m(prisma.document.updateMany)).toHaveBeenCalled();
  });

  it('propagates a retryable worker error (500) and does not mark the version', async () => {
    m(prisma.$queryRaw).mockResolvedValue(chunks(2));
    embeddings.embedBatch.mockRejectedValue(
      new EmbeddingError('AI worker responded 500', true, 500),
    );

    await expect(
      handler.handle({ documentId: DOC, version: 4 }),
    ).rejects.toThrow('500');
    expect(m(prisma.$executeRaw)).not.toHaveBeenCalled();
    expect(m(prisma.document.updateMany)).not.toHaveBeenCalled();
  });

  it('keeps batches that were already stored when a later batch fails (resume on retry)', async () => {
    m(prisma.$queryRaw).mockResolvedValue(chunks(40));
    embeddings.embedBatch
      .mockResolvedValueOnce(Array.from({ length: 32 }, () => [0.1, 0.2]))
      .mockRejectedValueOnce(new EmbeddingError('503', true, 503));

    await expect(
      handler.handle({ documentId: DOC, version: 4 }),
    ).rejects.toThrow('503');
    expect(m(prisma.$executeRaw)).toHaveBeenCalledTimes(1);
    expect(m(prisma.document.updateMany)).not.toHaveBeenCalled();
  });

  it('propagates a permanent worker error (422)', async () => {
    m(prisma.$queryRaw).mockResolvedValue(chunks(1));
    embeddings.embedBatch.mockRejectedValue(
      new EmbeddingError('AI worker responded 422', false, 422),
    );
    await expect(
      handler.handle({ documentId: DOC, version: 4 }),
    ).rejects.toMatchObject({ retryable: false });
  });

  it('reports stale if a newer publish arrived while embedding', async () => {
    m(prisma.$queryRaw).mockResolvedValue(chunks(1));
    m(prisma.document.updateMany).mockResolvedValue({ count: 0 });

    expect(await handler.handle({ documentId: DOC, version: 4 })).toEqual({
      status: 'stale',
    });
  });

  describe('rebuildChunks', () => {
    const html = '<h1>T</h1><p>A paragraph with enough text.</p>';
    const expectedText = 'T\n\nA paragraph with enough text.';

    beforeEach(() => {
      m(prisma.$queryRaw)
        .mockResolvedValueOnce([{ publishedVersion: 4 }]) // FOR UPDATE
        .mockResolvedValue([]); // pending chunks
      m(prisma.document.findUnique)
        .mockResolvedValueOnce({ publishedVersion: 4 })
        .mockResolvedValueOnce({ contentHtml: html });
    });

    it('replaces legacy chunks with chunks of the published HTML', async () => {
      m(prisma.documentChunk.findMany).mockResolvedValue([
        { textContent: 'legacy paragraph chunk' },
      ]);

      await handler.handle({
        documentId: DOC,
        version: 4,
        rebuildChunks: true,
      });

      expect(m(prisma.documentChunk.deleteMany)).toHaveBeenCalledWith({
        where: { documentId: DOC },
      });
      expect(m(prisma.documentChunk.createMany)).toHaveBeenCalledWith({
        data: [{ documentId: DOC, chunkIndex: 0, textContent: expectedText }],
      });
    });

    it('keeps existing rows (and their embeddings) when the chunks are unchanged', async () => {
      m(prisma.documentChunk.findMany).mockResolvedValue([
        { textContent: expectedText },
      ]);

      await handler.handle({
        documentId: DOC,
        version: 4,
        rebuildChunks: true,
      });

      expect(m(prisma.documentChunk.deleteMany)).not.toHaveBeenCalled();
      expect(m(prisma.documentChunk.createMany)).not.toHaveBeenCalled();
    });

    it('does nothing when the row lock shows a newer version', async () => {
      m(prisma.$queryRaw).mockReset();
      m(prisma.$queryRaw).mockResolvedValueOnce([{ publishedVersion: 5 }]);

      const result = await handler.handle({
        documentId: DOC,
        version: 4,
        rebuildChunks: true,
      });

      expect(result).toEqual({ status: 'stale' });
      expect(m(prisma.documentChunk.createMany)).not.toHaveBeenCalled();
    });
  });
});

describe('toVectorLiteral', () => {
  it('formats a pgvector literal', () => {
    expect(toVectorLiteral([1, 0.5, -2])).toBe('[1,0.5,-2]');
  });
});
