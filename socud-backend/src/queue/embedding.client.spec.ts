import { ConfigService } from '@nestjs/config';
import { EmbeddingClient, EmbeddingError } from './embedding.client';
import { Logger } from '@nestjs/common';
import { createConfigServiceMock } from '../test-utils/mocks';

const vec = (dim: number) => Array.from({ length: dim }, () => 0.5);
const ok = (embeddings: number[][]) =>
  ({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ embeddings, dim: embeddings[0]?.length }),
  }) as Response;
const fail = (status: number) =>
  ({ ok: false, status, json: () => Promise.resolve({}) }) as Response;

describe('EmbeddingClient', () => {
  let fetchMock: jest.SpyInstance;
  const build = (overrides: Record<string, unknown> = {}) =>
    new EmbeddingClient(
      createConfigServiceMock({
        EMBEDDING_DIM: 4,
        ...overrides,
      }) as unknown as ConfigService,
    );

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it('posts texts with token header, timeout signal and is_query flag', async () => {
    fetchMock.mockResolvedValue(ok([vec(4)]));
    const client = build({ AI_WORKER_TOKEN: 's3cret' });

    const out = await client.embed(['hello'], true);

    expect(out).toEqual([vec(4)]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://ai-worker.test/embed');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Worker-Token': 's3cret',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      texts: ['hello'],
      is_query: true,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('omits the token header when none is configured', async () => {
    fetchMock.mockResolvedValue(ok([vec(4)]));
    await build().embed(['a']);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('splits more than 32 texts into batches of at most 32, preserving order', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const { texts } = JSON.parse(init.body as string) as { texts: string[] };
      return Promise.resolve(ok(texts.map((t) => [Number(t), 0, 0, 0])));
    });
    const texts = Array.from({ length: 70 }, (_, i) => String(i));

    const out = await build({ EMBED_BATCH_SIZE: 32 }).embed(texts);

    const sizes = fetchMock.mock.calls.map(
      (c: [string, RequestInit]) =>
        (JSON.parse(c[1].body as string) as { texts: string[] }).texts.length,
    );
    expect(sizes).toEqual([32, 32, 6]);
    expect(out.map((v) => v[0])).toEqual(texts.map(Number));
  });

  it('defaults to batches of 1 and clamps EMBED_BATCH_SIZE to the worker limit of 32', () => {
    expect(build().batchSize).toBe(1);
    expect(build({ EMBED_BATCH_SIZE: 8 }).batchSize).toBe(8);
    expect(build({ EMBED_BATCH_SIZE: 100 }).batchSize).toBe(32);
    expect(build({ EMBED_BATCH_SIZE: 0 }).batchSize).toBe(1);
  });

  it('uses the short query timeout for is_query calls and the long one for documents', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue(ok([[1, 0, 0, 0]]));
    const client = build({
      EMBED_QUERY_TIMEOUT_MS: 1234,
      EMBED_TIMEOUT_MS: 98765,
    });

    await client.embed(['q'], true);
    await client.embed(['d'], false);

    expect(timeoutSpy.mock.calls.map((c) => c[0])).toEqual([1234, 98765]);
    timeoutSpy.mockRestore();
  });

  it.each([422, 400, 401, 413])(
    'treats %i as a permanent error',
    async (status) => {
      fetchMock.mockResolvedValue(fail(status));
      const err = await build()
        .embed(['a'])
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EmbeddingError);
      expect((err as EmbeddingError).retryable).toBe(false);
      expect((err as EmbeddingError).status).toBe(status);
    },
  );

  it.each([500, 502, 503, 429, 408])(
    'treats %i as retryable',
    async (status) => {
      fetchMock.mockResolvedValue(fail(status));
      const err = await build()
        .embed(['a'])
        .catch((e: unknown) => e);
      expect((err as EmbeddingError).retryable).toBe(true);
    },
  );

  it('treats network errors and timeouts as retryable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const err = await build()
      .embed(['a'])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmbeddingError);
    expect((err as EmbeddingError).retryable).toBe(true);
  });

  it('rejects vectors of the wrong dimension as a permanent error', async () => {
    fetchMock.mockResolvedValue(ok([vec(768)]));
    const err = await build()
      .embed(['a'])
      .catch((e: unknown) => e);
    expect((err as EmbeddingError).message).toMatch(
      /dimension 768, expected 4/,
    );
    expect((err as EmbeddingError).retryable).toBe(false);
  });

  it('rejects a response with a different number of embeddings than texts', async () => {
    fetchMock.mockResolvedValue(ok([vec(4)]));
    await expect(
      build({ EMBED_BATCH_SIZE: 2 }).embed(['a', 'b']),
    ).rejects.toThrow(/1 embeddings for 2/);
  });

  it('exposes provider and modelId for the default worker provider', () => {
    const client = build({ EMBEDDING_DIM: 1024 });
    expect(client.provider).toBe('worker');
    expect(client.modelId).toBe('qwen3-embedding-4b@1024');
    expect(
      build({ EMBEDDING_PROVIDER: 'worker', EMBEDDING_DIM: 512 }).modelId,
    ).toBe('qwen3-embedding-4b@512');
  });

  it('lets EMBEDDING_MODEL_ID override the worker model id', () => {
    expect(build({ EMBEDDING_MODEL_ID: 'my-model@4' }).modelId).toBe(
      'my-model@4',
    );
    expect(build({ EMBEDDING_MODEL_ID: '' }).modelId).toBe(
      'qwen3-embedding-4b@4',
    );
  });

  it('treats an empty EMBED_BATCH_SIZE (compose passes "" when unset) as unset', () => {
    expect(build({ EMBED_BATCH_SIZE: '' }).batchSize).toBe(1);
  });

  it('rejects an unknown EMBEDDING_PROVIDER', () => {
    expect(() => build({ EMBEDDING_PROVIDER: 'cloud' })).toThrow(
      /EMBEDDING_PROVIDER must be "worker" or "api"/,
    );
  });

  it('delegates to an injected provider', async () => {
    const provider = {
      name: 'api' as const,
      modelId: 'x@1',
      dim: 2,
      batchSize: 2,
      embedBatch: jest.fn((texts: string[]) =>
        Promise.resolve(texts.map(() => [1, 0])),
      ),
    };
    const client = new EmbeddingClient(
      createConfigServiceMock() as unknown as ConfigService,
      provider,
    );

    const out = await client.embed(['a', 'b', 'c'], true);

    expect(out).toHaveLength(3);
    expect(provider.embedBatch.mock.calls).toEqual([
      [['a', 'b'], true],
      [['c'], true],
    ]);
    expect(client.provider).toBe('api');
    expect(client.modelId).toBe('x@1');
  });

  it('defaults to 1024 dimensions', () => {
    expect(
      new EmbeddingClient(createConfigServiceMock() as unknown as ConfigService)
        .dim,
    ).toBe(1024);
  });
});

describe('EmbeddingClient profile', () => {
  const build = (overrides: Record<string, unknown> = {}) =>
    new EmbeddingClient(
      createConfigServiceMock({
        EMBEDDING_DIM: 4,
        ...overrides,
      }) as unknown as ConfigService,
    );
  afterEach(() => jest.restoreAllMocks());

  it('exposes the active profile, or null', () => {
    expect(build().profile).toBeNull();
    expect(build({ EMBEDDING_PROFILE: '' }).profile).toBeNull();
    expect(build({ EMBEDDING_PROFILE: 'pc' }).profile).toBe('pc');
  });

  it('describes profile, provider, model id and origin, never a secret', () => {
    expect(
      build({
        EMBEDDING_PROFILE: 'pc',
        AI_WORKER_URL: 'http://192.168.1.50:8000/path',
        AI_WORKER_TOKEN: 'tok-secret',
      }).describe(),
    ).toBe(
      'Embedding profile: pc (provider worker, model id qwen3-embedding-4b@4, http://192.168.1.50:8000)',
    );
    const api = build({
      EMBEDDING_PROFILE: 'api',
      EMBEDDING_PROVIDER: 'api',
      EMBEDDING_API_URL: 'https://openrouter.ai/api/v1',
      EMBEDDING_API_KEY: 'sk-secret',
      EMBEDDING_API_MODEL: 'qwen/qwen3-embedding-8b',
    }).describe();
    expect(api).toBe(
      'Embedding profile: api (provider api, model id qwen/qwen3-embedding-8b@4, https://openrouter.ai)',
    );
    expect(api).not.toContain('sk-secret');
    expect(build().describe()).toMatch(
      /^Embedding profile: none \(provider worker/,
    );
  });

  it('logs the line at startup, but not under NODE_ENV=test', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const client = build({ EMBEDDING_PROFILE: 'local' });
    await client.onModuleInit(); // NODE_ENV=test under jest
    expect(log).not.toHaveBeenCalled();

    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      await client.onModuleInit();
    } finally {
      process.env.NODE_ENV = env;
    }
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^Embedding profile: local \(provider worker/),
    );
  });
});
