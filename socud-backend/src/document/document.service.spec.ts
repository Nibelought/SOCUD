import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { DocumentService } from './document.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  createConfigServiceMock,
  createPrismaServiceMock,
} from '../test-utils/mocks';

const m = (fn: unknown) => fn as jest.Mock;

describe('DocumentService', () => {
  let service: DocumentService;
  let prisma: jest.Mocked<PrismaService>;
  let fetchMock: jest.SpyInstance;

  async function build(configOverrides: Record<string, unknown> = {}) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentService,
        { provide: PrismaService, useValue: createPrismaServiceMock() },
        {
          provide: ConfigService,
          useValue: createConfigServiceMock(configOverrides),
        },
      ],
    }).compile();

    service = module.get<DocumentService>(DocumentService);
    prisma = module.get(PrismaService);
    m(prisma.$transaction).mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(prisma),
    );
  }

  /** Space OWNER of an existing, non-archived document. */
  function allowPublish() {
    m(prisma.user.findUnique).mockResolvedValue({ isSystemAdmin: false });
    m(prisma.document.findUnique).mockResolvedValue({
      id: 'doc',
      isArchived: false,
      members: [],
      space: { members: [{ role: 'OWNER' }] },
    });
  }

  beforeEach(async () => {
    await build();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('AI worker down'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('publishDocument', () => {
    const uuid = '3f2b8c1e-8a4d-4f5e-9b1a-2c3d4e5f6a7b';

    it('stores only sanitized HTML and extracts links from the sanitized HTML', async () => {
      allowPublish();
      const dirty =
        `<p onclick="x()">Hi <a href="/document/${uuid}">l</a>` +
        `<a href="javascript:alert('${'4f2b8c1e-8a4d-4f5e-9b1a-2c3d4e5f6a7c'}')">bad</a></p>` +
        '<script>alert(1)</script><iframe src="https://evil.example"></iframe>';

      const result = await service.publishDocument('doc', 'user', {
        html: dirty,
      });

      const stored = (
        m(prisma.document.update).mock.calls[0][0] as {
          data: { contentHtml: string };
        }
      ).data.contentHtml;
      expect(stored).toBe(
        `<p>Hi <a href="/document/${uuid}" rel="noopener noreferrer">l</a><a rel="noopener noreferrer">bad</a></p>`,
      );
      // The UUID hidden in the dropped javascript: href must not become a link.
      expect(m(prisma.documentLink.createMany)).toHaveBeenCalledWith({
        data: [{ sourceDocId: 'doc', targetDocId: uuid }],
        skipDuplicates: true,
      });
      expect(result.extractedLinksCount).toBe(1);
    });

    it('logs only the document id, HTML length and link count, never content', async () => {
      allowPublish();
      const logSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const secret = 'TOP-SECRET-CONTENT';

      await service.publishDocument('doc', 'user', {
        html: `<p>${secret}</p><a href="/document/${uuid}">x</a>`,
      });

      const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).not.toContain(secret);
      expect(logged).not.toContain(uuid);
      expect(logged).not.toContain('<p>');
      expect(logged).toMatch(/doc.*HTML length: \d+.*Links: 1/);
    });

    it('sends the worker token and a timeout signal with the embed request', async () => {
      await build({ AI_WORKER_TOKEN: 's3cret' });
      fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
        json: () =>
          Promise.resolve({
            embeddings: [
              [0.1, 0.2],
              [0.3, 0.4],
            ],
          }),
      } as Response);
      allowPublish();
      m(prisma.$executeRaw).mockResolvedValue(1);

      await service.publishDocument('doc', 'user', {
        html: '<p>First paragraph long enough</p><p>Second paragraph long enough</p>',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://ai-worker.test/embed');
      expect(init.headers).toEqual({
        'Content-Type': 'application/json',
        'X-Worker-Token': 's3cret',
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('omits the worker token header when AI_WORKER_TOKEN is not configured', async () => {
      fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
        json: () => Promise.resolve({ embeddings: [[0.1]] }),
      } as Response);
      allowPublish();
      m(prisma.$executeRaw).mockResolvedValue(1);

      await service.publishDocument('doc', 'user', {
        html: '<p>A paragraph that is long enough</p>',
      });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    });
  });

  describe('hybridSearch', () => {
    it('uses a parameterized query: ids and vector are bound values, not SQL text', async () => {
      const ids = ['id-1', 'id-2\'); DROP TABLE "Document"; --'];
      m(prisma.user.findUnique).mockResolvedValue({ isSystemAdmin: true });
      m(prisma.document.findMany).mockResolvedValue(
        ids.map((id) => ({ id, title: id, space: { name: 'S' } })),
      );
      fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
        json: () => Promise.resolve({ embeddings: [[0.5, 0.25]] }),
      } as Response);
      m(prisma.$queryRaw)
        .mockResolvedValueOnce([
          { documentId: 'id-1', textContent: 'semantic hit', score: 0.9 },
        ])
        .mockResolvedValueOnce([
          { documentId: ids[1], textContent: 'keyword hit' },
        ]);

      const results = await service.hybridSearch('user', 'query');

      expect(
        (prisma as unknown as Record<string, unknown>)['$queryRawUnsafe'],
      ).toBeUndefined();
      const [strings, ...values] = m(prisma.$queryRaw).mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      // Static SQL fragments contain no ids or vector literals ...
      expect(strings.join('?')).not.toContain('DROP TABLE');
      expect(strings.join('?')).not.toContain('id-1');
      // ... they are passed as bound parameters (the id list as a Prisma.join fragment).
      const joined = values.find(
        (v) => typeof v === 'object' && v !== null && 'values' in v,
      ) as { values: unknown[] };
      expect(joined.values).toEqual(ids);
      expect(values.filter((v) => v === '[0.5,0.25]')).toHaveLength(2);
      expect(results.map((r) => r.type)).toEqual(['semantic', 'keyword']);
    });
  });
});
