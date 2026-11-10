import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PermissionService } from '../permission/permission.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingClient } from '../queue/embedding.client';
import { createPrismaServiceMock } from '../test-utils/mocks';
import {
  HEADLINE_START as S,
  HEADLINE_STOP as E,
  MAX_QUERY_LENGTH,
  QUERY_EMBED_TIMEOUT_MS,
} from './search.constants';
import { escapeLike, SearchService } from './search.service';

const m = (fn: unknown) => fn as jest.Mock;

const USER = 'user-1';
const SCOPED = {
  isArchived: false,
  OR: [
    { space: { members: { some: { userId: USER } } } },
    { members: { some: { userId: USER } } },
  ],
};

type Kind = 'semantic' | 'keyword' | 'title';
const kindOf = (strings: TemplateStringsArray): Kind | 'other' => {
  const sql = strings.join('?');
  if (sql.includes('<=>')) return 'semantic';
  if (sql.includes('ts_rank_cd')) return 'keyword';
  if (sql.includes('word_similarity')) return 'title';
  return 'other';
};

const isSql = (v: unknown): v is Prisma.Sql =>
  typeof v === 'object' &&
  v !== null &&
  Array.isArray((v as Prisma.Sql).strings) &&
  Array.isArray((v as Prisma.Sql).values);

/** Every bound value of a tagged-template call, including nested Prisma.Sql fragments. */
function boundValues(values: unknown[]): unknown[] {
  return values.flatMap((v) => (isSql(v) ? boundValues(v.values) : [v]));
}
function sqlText(strings: ArrayLike<string>, values: unknown[]): string {
  return (
    Array.from(strings).join('?') +
    values
      .filter(isSql)
      .map((v) => sqlText(v.strings, v.values))
      .join('')
  );
}

describe('SearchService', () => {
  let service: SearchService;
  let prisma: jest.Mocked<PrismaService>;
  let embeddings: { embedQuery: jest.Mock };
  let hits: Record<Kind, unknown[] | Error>;
  let docs: Array<{ id: string; title: string; space: { name: string } }>;
  let warn: jest.SpyInstance;

  const calls = (kind: Kind) =>
    m(prisma.$queryRaw).mock.calls.filter(
      ([strings]) => kindOf(strings as TemplateStringsArray) === kind,
    ) as [TemplateStringsArray, ...unknown[]][];

  beforeEach(async () => {
    hits = { semantic: [], keyword: [], title: [] };
    docs = [];
    embeddings = { embedQuery: jest.fn().mockResolvedValue([0.5, 0.25]) };
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    const moduleRef = await Test.createTestingModule({
      providers: [
        SearchService,
        PermissionService,
        { provide: PrismaService, useValue: createPrismaServiceMock() },
        { provide: EmbeddingClient, useValue: embeddings },
      ],
    }).compile();
    service = moduleRef.get(SearchService);
    prisma = moduleRef.get(PrismaService);

    m(prisma.user.findUnique).mockResolvedValue({ isSystemAdmin: false });
    m(prisma.$transaction).mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(prisma),
    );
    m(prisma.$executeRaw).mockResolvedValue(1);
    m(prisma.$queryRaw).mockImplementation((strings: TemplateStringsArray) => {
      const kind = kindOf(strings);
      const value = kind === 'other' ? [] : hits[kind];
      return value instanceof Error
        ? Promise.reject(value)
        : Promise.resolve(value);
    });
    m(prisma.document.findMany).mockImplementation(() => Promise.resolve(docs));
  });
  afterEach(() => jest.restoreAllMocks());

  const doc = (id: string, title = `Title ${id}`, space = 'Space') => ({
    id,
    title,
    space: { name: space },
  });

  it('returns nothing for a blank query without touching the database', async () => {
    await expect(service.search(USER, '')).resolves.toEqual([]);
    await expect(service.search(USER, '   ')).resolves.toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
  });

  it('fuses the three retrievers, keeps the response shape and uses the space name', async () => {
    hits.semantic = [
      { id: 'a', similarity: 0.874, text: 'semantic chunk of a' },
      { id: 'b', similarity: 0.5, text: 'semantic chunk of b' },
    ];
    hits.keyword = [
      {
        id: 'b',
        rank: 0.4,
        inTitle: false,
        headline: `про ${S}деплой${E} сервера`,
      },
    ];
    hits.title = [{ id: 'c', similarity: 0.7, lead: 'lead of c' }];
    docs = [
      doc('a', 'A', 'Alpha'),
      doc('b', 'B', 'Beta'),
      doc('c', 'C', 'Gamma'),
    ];

    const results = await service.search(USER, 'деплой');

    expect(results.map((r) => r.id)).toEqual(['b', 'a', 'c']);
    const [b, a, c] = results;
    expect(b).toMatchObject({
      id: 'b',
      title: 'B',
      space: 'Beta',
      type: 'semantic',
      score: 0.5,
      matchedBy: ['semantic', 'keyword'],
      snippet: 'про деплой сервера',
      highlights: [{ start: 4, end: 10 }],
    });
    expect(a).toMatchObject({
      id: 'a',
      type: 'semantic',
      score: 0.87,
      snippet: 'semantic chunk of a',
    });
    expect(a.highlights).toBeUndefined();
    expect(c).toMatchObject({
      id: 'c',
      space: 'Gamma',
      type: 'keyword',
      score: null,
      matchedBy: ['title'],
      snippet: 'lead of c',
    });
    expect(b.rrfScore).toBeGreaterThan(a.rrfScore);
  });

  it('marks a keyword hit on the title as matched by title as well', async () => {
    hits.keyword = [{ id: 'a', rank: 1, inTitle: true, headline: null }];
    docs = [doc('a')];
    const [r] = await service.search(USER, 'q1');
    expect(r.matchedBy).toEqual(['keyword', 'title']);
    expect(r.snippet).toBe('');
    expect(r.score).toBeNull();
  });

  describe('degradation', () => {
    beforeEach(() => {
      hits.keyword = [{ id: 'a', rank: 1, inTitle: false, headline: null }];
      docs = [doc('a')];
    });

    it('falls back to keyword + title when the query embedding fails', async () => {
      embeddings.embedQuery.mockRejectedValue(
        new Error('AI worker unreachable'),
      );
      const results = await service.search(USER, 'secret query text');
      expect(results.map((r) => r.id)).toEqual(['a']);
      expect(calls('semantic')).toHaveLength(0);
      // the query text is never logged
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(
        'secret query text',
      );
    });

    it('still answers when the semantic SQL fails', async () => {
      hits.semantic = new Error('hnsw boom');
      await expect(service.search(USER, 'q1')).resolves.toHaveLength(1);
    });

    it('still answers from semantic when keyword and title fail', async () => {
      hits.keyword = new Error('fts boom');
      hits.title = new Error('trgm boom');
      hits.semantic = [{ id: 'a', similarity: 0.9, text: 't' }];
      const results = await service.search(USER, 'q1');
      expect(results.map((r) => r.id)).toEqual(['a']);
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('throws only if every retriever failed', async () => {
      embeddings.embedQuery.mockRejectedValue(new Error('down'));
      hits.keyword = new Error('db down');
      hits.title = new Error('db down');
      await expect(service.search(USER, 'q1')).rejects.toThrow('down');
    });

    it('uses a short embedding timeout for queries', async () => {
      await service.search(USER, 'q1');
      expect(embeddings.embedQuery).toHaveBeenCalledWith(
        'q1',
        QUERY_EMBED_TIMEOUT_MS,
      );
      expect(QUERY_EMBED_TIMEOUT_MS).toBeLessThanOrEqual(5000);
    });
  });

  describe('permissions', () => {
    it('never returns a document the caller cannot see, even if a retriever found it', async () => {
      hits.semantic = [
        { id: 'secret', similarity: 0.99, text: 'secret chunk' },
        { id: 'a', similarity: 0.5, text: 'ok' },
      ];
      hits.keyword = [
        { id: 'secret', rank: 1, inTitle: true, headline: 'secret' },
      ];
      hits.title = [{ id: 'secret', similarity: 1, lead: 'secret' }];
      docs = [doc('a')]; // the permission-filtered lookup does not return `secret`

      const results = await service.search(USER, 'q1');

      expect(results.map((r) => r.id)).toEqual(['a']);
      expect(JSON.stringify(results)).not.toContain('secret');
    });

    it('re-checks the final ids with the canonical Prisma filter', async () => {
      hits.keyword = [{ id: 'a', rank: 1, inTitle: false, headline: null }];
      docs = [doc('a')];
      await service.search(USER, 'q1');
      expect(prisma.document.findMany).toHaveBeenCalledWith({
        where: { AND: [{ id: { in: ['a'] } }, SCOPED] },
        select: { id: true, title: true, space: { select: { name: true } } },
      });
    });

    it('admins only get the isArchived filter', async () => {
      m(prisma.user.findUnique).mockResolvedValue({ isSystemAdmin: true });
      hits.keyword = [{ id: 'a', rank: 1, inTitle: false, headline: null }];
      docs = [doc('a')];
      await service.search(USER, 'q1');
      expect(
        (m(prisma.document.findMany).mock.calls[0][0] as { where: unknown })
          .where,
      ).toEqual({ AND: [{ id: { in: ['a'] } }, { isArchived: false }] });
    });

    it.each<Kind>(['semantic', 'keyword', 'title'])(
      'the %s retriever filters by the caller inside SQL (no unbounded id list)',
      async (kind) => {
        await service.search(USER, 'query');
        const [call] = calls(kind);
        expect(call).toBeDefined();
        const [strings, ...values] = call;
        const text = sqlText(strings, values);
        expect(text).toContain('"isArchived" = false');
        expect(text).toContain('"SpaceMember"');
        expect(text).toContain('"DocumentMember"');
        expect(text).not.toMatch(/\bIN\s*\(/);
        // the user id is a bound parameter of the access fragment, never SQL text
        expect(text).not.toContain(USER);
        // 3 occurrences per access fragment (admin, space member, document member)
        const occurrences = boundValues(values).filter((v) => v === USER);
        expect(occurrences.length).toBeGreaterThanOrEqual(3);
        expect(occurrences.length % 3).toBe(0);
      },
    );

    it('nothing is queried for an empty result set of ids', async () => {
      await expect(service.search(USER, 'q1')).resolves.toEqual([]);
      expect(prisma.document.findMany).not.toHaveBeenCalled();
    });
  });

  describe('SQL safety', () => {
    it('binds the query, the vector and LIKE patterns as parameters', async () => {
      const evil = `'); DROP TABLE "Document"; --`;
      await service.search(USER, evil);

      expect(
        (prisma as unknown as Record<string, unknown>)['$queryRawUnsafe'],
      ).toBeUndefined();
      for (const kind of ['semantic', 'keyword', 'title'] as Kind[]) {
        const [strings, ...values] = calls(kind)[0];
        const text = sqlText(strings, values);
        expect(text).not.toContain('DROP TABLE');
        expect(text).not.toContain('0.5,0.25');
      }
      expect(boundValues(calls('semantic')[0].slice(1))).toContain(
        '[0.5,0.25]',
      );
      expect(boundValues(calls('keyword')[0].slice(1))).toContain(evil);
    });

    it('escapes LIKE wildcards in the title pattern', async () => {
      await service.search(USER, '100%_a\\b');
      const values = boundValues(calls('title')[0].slice(1));
      expect(values).toContain('%100\\%\\_a\\\\b%');
      expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
    });

    it('cuts over-long queries', async () => {
      await service.search(USER, 'x'.repeat(MAX_QUERY_LENGTH * 3));
      expect(embeddings.embedQuery.mock.calls[0][0]).toHaveLength(
        MAX_QUERY_LENGTH,
      );
    });

    it('skips the trigram retriever for a single character', async () => {
      await service.search(USER, 'a');
      expect(calls('title')).toHaveLength(0);
      expect(calls('keyword')).toHaveLength(1);
    });

    it('turns on iterative HNSW scans so the access filter does not starve the index scan', async () => {
      await service.search(USER, 'query');
      const configured = m(prisma.$executeRaw)
        .mock.calls.map(([strings]) =>
          (strings as TemplateStringsArray).join('?'),
        )
        .join('\n');
      expect(configured).toContain('hnsw.iterative_scan');
      expect(configured).toContain('pg_trgm.word_similarity_threshold');
    });
  });

  describe('snippets are plain text', () => {
    it('returns hostile chunk text literally, without markup of our own', async () => {
      const evil = '<img src=x onerror=alert(1)> <script>alert(2)</script>';
      hits.semantic = [{ id: 'a', similarity: 0.5, text: `${evil}\n\n&amp;` }];
      hits.keyword = [
        { id: 'b', rank: 1, inTitle: false, headline: `${evil} ${S}hit${E}` },
      ];
      docs = [doc('a'), doc('b')];

      const results = await service.search(USER, 'q1');

      for (const r of results) {
        expect(r.snippet).toContain('<img src=x onerror=alert(1)>');
        expect(r.snippet).not.toMatch(/&lt;|&#|<mark|<b>/);
        expect(r.snippet).not.toContain(S);
        expect(r.snippet).not.toContain(E);
      }
      const b = results.find((r) => r.id === 'b');
      expect(b?.highlights).toHaveLength(1);
    });
  });
});
