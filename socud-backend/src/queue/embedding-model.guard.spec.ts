import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createPrismaServiceMock } from '../test-utils/mocks';
import { EmbeddingClient } from './embedding.client';
import {
  EMBED_WARN_INTERVAL_MS,
  EmbeddingModelGuard,
  LEGACY_EMBEDDING_MODEL,
  STATUS_CACHE_TTL_MS,
  buildRecommendedActions,
  describeMismatch,
} from './embedding-model.guard';

const m = (fn: unknown) => fn as jest.Mock;
const QWEN = 'qwen3-embedding-4b@1024';
const OPENAI = 'openai/text-embedding-3-small@1024';

describe('EmbeddingModelGuard', () => {
  let prisma: jest.Mocked<PrismaService>;
  let client: {
    modelId: string;
    provider: 'worker' | 'api';
    dim: number;
    profile: string | null;
  };
  let guard: EmbeddingModelGuard;
  let warn: jest.SpyInstance;
  let now: number;
  const warned = (n: number) => String((warn.mock.calls[n] as [unknown])[0]);

  const stored = (
    rows: { model: string; chunks: number; documents: number }[],
  ) => m(prisma.$queryRaw).mockResolvedValue(rows);

  beforeEach(() => {
    now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    prisma = createPrismaServiceMock();
    client = { modelId: QWEN, provider: 'worker', dim: 1024, profile: 'local' };
    guard = new EmbeddingModelGuard(
      prisma,
      client as unknown as EmbeddingClient,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('reports no mismatch when the index only holds the active model', async () => {
    stored([{ model: QWEN, chunks: 120, documents: 14 }]);
    const status = await guard.getStatus();
    expect(status).toEqual({
      profile: 'local',
      activeModel: QWEN,
      provider: 'worker',
      dim: 1024,
      stored: [{ model: QWEN, chunks: 120, documents: 14 }],
      mismatch: false,
      recommendedActions: [],
    });
  });

  it('reports no mismatch for an empty index (nothing embedded yet)', async () => {
    stored([]);
    const status = await guard.getStatus();
    expect(status.mismatch).toBe(false);
    expect(status.stored).toEqual([]);
  });

  it('flags a mismatch and recommends re-embedding, switching back, or declaring the same space', async () => {
    client.modelId = OPENAI;
    client.provider = 'api';
    stored([{ model: QWEN, chunks: 120, documents: 14 }]);

    const status = await guard.getStatus();

    expect(status.mismatch).toBe(true);
    expect(status.provider).toBe('api');
    expect(status.recommendedActions).toHaveLength(3);
    expect(status.recommendedActions[0]).toContain(
      'npm run backfill:embeddings -- --reembed-mismatched',
    );
    expect(status.recommendedActions[0]).toContain(OPENAI);
    expect(status.recommendedActions[1]).toContain('EMBEDDING_PROVIDER');
    expect(status.recommendedActions[1]).toContain(QWEN);
    expect(status.recommendedActions[2]).toContain(
      `EMBEDDING_MODEL_ID=${QWEN}`,
    );
  });

  it('flags a mismatch when the active model is only one of several stored models', async () => {
    stored([
      { model: QWEN, chunks: 100, documents: 10 },
      { model: OPENAI, chunks: 5, documents: 1 },
    ]);
    expect((await guard.getStatus()).mismatch).toBe(true);
  });

  it('counts legacy rows (vector but NULL model) as the legacy Qwen3 model, and excludes rows without a vector', async () => {
    stored([{ model: LEGACY_EMBEDDING_MODEL, chunks: 3, documents: 1 }]);
    await guard.getStatus();
    const [strings, legacy] = m(prisma.$queryRaw).mock.calls[0] as [
      TemplateStringsArray,
      string,
    ];
    const sql = strings.join('?');
    expect(sql).toContain('COALESCE("embeddingModel", ?)');
    expect(sql).toContain('"embedding" IS NOT NULL');
    expect(legacy).toBe('qwen3-embedding-4b@1024');
  });

  it('treats legacy rows as a mismatch for a non-Qwen3 active model, and not for the default worker', async () => {
    stored([{ model: LEGACY_EMBEDDING_MODEL, chunks: 3, documents: 1 }]);
    expect((await guard.getStatus()).mismatch).toBe(false);

    client.modelId = OPENAI;
    expect((await guard.getStatus(true)).mismatch).toBe(true);
  });

  it('coerces numeric strings from the driver (COUNT as bigint)', async () => {
    stored([{ model: QWEN, chunks: '7', documents: '2' } as never]);
    expect((await guard.getStatus()).stored).toEqual([
      { model: QWEN, chunks: 7, documents: 2 },
    ]);
  });

  describe('caching', () => {
    it('reuses the status within the TTL and recomputes afterwards', async () => {
      stored([{ model: QWEN, chunks: 1, documents: 1 }]);
      await guard.getStatus();
      now += STATUS_CACHE_TTL_MS - 1;
      await guard.getStatus();
      expect(m(prisma.$queryRaw)).toHaveBeenCalledTimes(1);

      now += 2;
      await guard.getStatus();
      expect(m(prisma.$queryRaw)).toHaveBeenCalledTimes(2);
    });

    it('can be bypassed or invalidated', async () => {
      stored([{ model: QWEN, chunks: 1, documents: 1 }]);
      await guard.getStatus();
      await guard.getStatus(true);
      expect(m(prisma.$queryRaw)).toHaveBeenCalledTimes(2);
      guard.invalidate();
      await guard.getStatus();
      expect(m(prisma.$queryRaw)).toHaveBeenCalledTimes(3);
    });

    it('does not cache a failure', async () => {
      m(prisma.$queryRaw).mockRejectedValueOnce(new Error('db down'));
      await expect(guard.getStatus()).rejects.toThrow('db down');
      stored([]);
      await expect(guard.getStatus()).resolves.toMatchObject({
        mismatch: false,
      });
    });
  });

  describe('startup warning', () => {
    it('logs one WARN naming stored model, active model, counts and the actions', async () => {
      client.modelId = OPENAI;
      stored([{ model: QWEN, chunks: 120, documents: 14 }]);

      await guard.warnOnStartup();

      expect(warn).toHaveBeenCalledTimes(1);
      const message = warned(0);
      expect(message).toContain(QWEN);
      expect(message).toContain(OPENAI);
      expect(message).toContain('120 chunks');
      expect(message).toContain('14 documents');
      expect(message).toContain('--reembed-mismatched');
      expect(message).toContain('EMBEDDING_MODEL_ID');
      expect(message).toContain('unreliable');
    });

    it('is silent without a mismatch', async () => {
      stored([{ model: QWEN, chunks: 1, documents: 1 }]);
      await guard.warnOnStartup();
      expect(warn).not.toHaveBeenCalled();
    });

    it('never throws when the database is unavailable', async () => {
      m(prisma.$queryRaw).mockRejectedValue(new Error('db down'));
      await expect(guard.warnOnStartup()).resolves.toBeNull();
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('warning while embedding', () => {
    beforeEach(() => {
      client.modelId = OPENAI;
      stored([{ model: QWEN, chunks: 120, documents: 14 }]);
    });

    it('is rate-limited: one WARN per interval no matter how many documents are embedded', async () => {
      for (let i = 0; i < 50; i++) await guard.warnBeforeEmbedding(`doc-${i}`);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warned(0)).toContain('doc-0');

      now += EMBED_WARN_INTERVAL_MS + 1;
      await guard.warnBeforeEmbedding('doc-later');
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warned(1)).toContain('doc-later');
    });

    it('does not consume the rate limit while there is no mismatch', async () => {
      client.modelId = QWEN;
      await guard.warnBeforeEmbedding('doc-a');
      expect(warn).not.toHaveBeenCalled();

      client.modelId = OPENAI;
      guard.invalidate();
      await guard.warnBeforeEmbedding('doc-b');
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('swallows errors so embedding is never blocked', async () => {
      guard.invalidate();
      m(prisma.$queryRaw).mockRejectedValue(new Error('db down'));
      await expect(guard.warnBeforeEmbedding('doc')).resolves.toBeUndefined();
    });
  });

  describe('helpers', () => {
    it('buildRecommendedActions is empty when only the active model is stored', () => {
      expect(
        buildRecommendedActions(QWEN, [
          { model: QWEN, chunks: 1, documents: 1 },
        ]),
      ).toEqual([]);
    });

    it('describeMismatch mentions how many chunks already use the active model', () => {
      const text = describeMismatch({
        profile: null,
        activeModel: OPENAI,
        provider: 'api',
        dim: 1024,
        stored: [
          { model: QWEN, chunks: 10, documents: 2 },
          { model: OPENAI, chunks: 4, documents: 1 },
        ],
        mismatch: true,
        recommendedActions: ['do x'],
      });
      expect(text).toContain(
        '4 chunks in 1 documents already use the active model',
      );
      expect(text).toContain('(1) do x');
    });
  });
});
