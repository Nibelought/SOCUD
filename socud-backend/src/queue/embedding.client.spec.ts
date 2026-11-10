import { ConfigService } from '@nestjs/config';
import { EmbeddingClient, EmbeddingError } from './embedding.client';
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

  it('defaults to batches of 4 and clamps EMBED_BATCH_SIZE to the worker limit of 32', () => {
    expect(build().batchSize).toBe(4);
    expect(build({ EMBED_BATCH_SIZE: 8 }).batchSize).toBe(8);
    expect(build({ EMBED_BATCH_SIZE: 100 }).batchSize).toBe(32);
    expect(build({ EMBED_BATCH_SIZE: 0 }).batchSize).toBe(4);
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
    await expect(build().embed(['a', 'b'])).rejects.toThrow(
      /1 embeddings for 2/,
    );
  });

  it('defaults to 1024 dimensions', () => {
    expect(
      new EmbeddingClient(createConfigServiceMock() as unknown as ConfigService)
        .dim,
    ).toBe(1024);
  });
});
