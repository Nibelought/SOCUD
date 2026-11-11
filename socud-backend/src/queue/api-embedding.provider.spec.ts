import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { createConfigServiceMock } from '../test-utils/mocks';
import {
  ApiEmbeddingProvider,
  DEFAULT_QUERY_INSTRUCTION,
  parseRetryAfter,
} from './api-embedding.provider';
import { EmbeddingClient } from './embedding.client';
import { EmbeddingConfigError, EmbeddingError } from './embedding.error';

interface Recorded {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: {
    model?: string;
    input?: string[];
    dimensions?: number;
    encoding_format?: string;
  };
}

type Reply = {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
  raw?: string;
  delayMs?: number;
};

const KEY = 'sk-or-v1-super-secret-key';

/** unit vector with `dim` components whose first component is `first` (rest balances the norm). */
const unit = (dim: number, first = 1): number[] => {
  const v = new Array<number>(dim).fill(0);
  v[0] = first;
  if (dim > 1) v[1] = Math.sqrt(Math.max(0, 1 - first * first));
  return v;
};
const embeddings = (vectors: number[][], shuffle = false) => ({
  object: 'list',
  model: 'm',
  data: vectors
    .map((embedding, index) => ({ object: 'embedding', index, embedding }))
    [shuffle ? 'reverse' : 'slice'](),
});

describe('ApiEmbeddingProvider (against a local mock server)', () => {
  let server: Server;
  let baseUrl: string;
  let requests: Recorded[];
  let replies: Reply[];
  let sleeps: number[];
  const timers = new Set<NodeJS.Timeout>();

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        requests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: raw ? (JSON.parse(raw) as Recorded['body']) : {},
        });
        const reply = replies.shift() ?? { status: 500, json: {} };
        const timer = setTimeout(() => {
          timers.delete(timer);
          res.writeHead(reply.status ?? 200, {
            'Content-Type': 'application/json',
            ...reply.headers,
          });
          res.end(reply.raw ?? JSON.stringify(reply.json ?? {}));
        }, reply.delayMs ?? 0);
        timers.add(timer);
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterAll(async () => {
    timers.forEach((t) => clearTimeout(t));
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    requests = [];
    replies = [];
    sleeps = [];
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const build = (overrides: Record<string, unknown> = {}) =>
    new ApiEmbeddingProvider(
      createConfigServiceMock({
        EMBEDDING_PROVIDER: 'api',
        EMBEDDING_API_URL: baseUrl,
        EMBEDDING_API_KEY: KEY,
        EMBEDDING_API_MODEL: 'qwen/qwen3-embedding-4b',
        EMBEDDING_DIM: 4,
        ...overrides,
      }) as unknown as ConfigService,
      {
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      },
    );

  const failure = async (
    promise: Promise<unknown>,
  ): Promise<EmbeddingError> => {
    const err = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(EmbeddingError);
    return err as EmbeddingError;
  };

  it('posts to {url}/embeddings with the bearer key, model, float format and prepared inputs', async () => {
    replies.push({ json: embeddings([unit(4), unit(4, 0.6)]) });

    const out = await build().embedBatch(['# Hello **world**', 'plain'], false);

    expect(out).toEqual([unit(4), unit(4, 0.6)]);
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/v1/embeddings');
    expect(req.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.body).toEqual({
      model: 'qwen/qwen3-embedding-4b',
      input: ['Hello world', 'plain'],
      encoding_format: 'float',
    });
  });

  it('adds the Qwen3 query instruction to queries only', async () => {
    replies.push(
      { json: embeddings([unit(4)]) },
      { json: embeddings([unit(4)]) },
    );
    const provider = build();

    await provider.embedBatch(['how to **reset**?'], true);
    await provider.embedBatch(['how to **reset**?'], false);

    expect(requests[0].body.input).toEqual([
      `Instruct: ${DEFAULT_QUERY_INSTRUCTION}\nQuery:how to reset?`,
    ]);
    expect(requests[1].body.input).toEqual(['how to reset?']);
  });

  it('uses no instruction for non-Qwen3 models unless one is configured', async () => {
    replies.push(
      { json: embeddings([unit(4)]) },
      { json: embeddings([unit(4)]) },
      { json: embeddings([unit(4)]) },
    );

    await build({
      EMBEDDING_API_MODEL: 'openai/text-embedding-3-small',
    }).embedBatch(['q'], true);
    await build({
      EMBEDDING_API_MODEL: 'openai/text-embedding-3-small',
      EMBEDDING_API_QUERY_INSTRUCTION: 'Find the answer',
    }).embedBatch(['q'], true);
    await build({ EMBEDDING_API_QUERY_INSTRUCTION: 'off' }).embedBatch(
      ['q'],
      true,
    );

    expect(requests.map((r) => r.body.input)).toEqual([
      ['q'],
      ['Instruct: Find the answer\nQuery:q'],
      ['q'],
    ]);
  });

  it('replaces a text that is empty after cleaning, which APIs reject', async () => {
    replies.push({ json: embeddings([unit(4), unit(4)]) });
    await build().embedBatch(['   \n', '```\n```'], false);
    expect(requests[0].body.input).toEqual(['.', '.']);
  });

  it('sends the optional attribution headers and the dimensions parameter', async () => {
    replies.push({ json: embeddings([unit(4)]) });

    await build({
      EMBEDDING_API_DIMENSIONS: 4,
      EMBEDDING_API_REFERER: 'https://socud.example',
      EMBEDDING_API_TITLE: 'SOCUD',
    }).embedBatch(['x'], false);

    expect(requests[0].body.dimensions).toBe(4);
    expect(requests[0].headers['http-referer']).toBe('https://socud.example');
    expect(requests[0].headers['x-title']).toBe('SOCUD');
  });

  it('omits dimensions and attribution headers when not configured', async () => {
    replies.push({ json: embeddings([unit(4)]) });
    await build().embedBatch(['x'], false);
    expect(requests[0].body).not.toHaveProperty('dimensions');
    expect(requests[0].headers['http-referer']).toBeUndefined();
    expect(requests[0].headers['x-title']).toBeUndefined();
  });

  it('puts the vectors back in input order using the index field', async () => {
    replies.push({
      json: embeddings([unit(4, 0.1), unit(4, 0.2), unit(4, 0.3)], true),
    });

    const out = await build().embedBatch(['a', 'b', 'c'], false);

    expect(out.map((v) => v[0])).toEqual([0.1, 0.2, 0.3]);
  });

  it('truncates longer vectors to EMBEDDING_DIM, renormalises, and warns once', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    replies.push(
      { json: embeddings([[3, 4, 12, 0]]) },
      { json: embeddings([[3, 4, 12, 0]]) },
    );
    const provider = build({ EMBEDDING_DIM: 2 });

    const [first] = await provider.embedBatch(['a'], false);
    await provider.embedBatch(['b'], false);

    expect(first).toHaveLength(2);
    expect(first[0]).toBeCloseTo(0.6);
    expect(first[1]).toBeCloseTo(0.8);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/Matryoshka/);
  });

  it('fails permanently when vectors are shorter than EMBEDDING_DIM', async () => {
    replies.push({ json: embeddings([unit(4)]) });
    const err = await failure(
      build({ EMBEDDING_DIM: 8 }).embedBatch(['a'], false),
    );
    expect(err).toBeInstanceOf(EmbeddingConfigError);
    expect(err.retryable).toBe(false);
    expect(err.message).toMatch(/4-dimensional.*EMBEDDING_DIM is 8/);
  });

  it('rejects a truncated vector whose kept part is all zeros', async () => {
    replies.push({ json: embeddings([[0, 0, 1, 1]]) });
    const err = await failure(
      build({ EMBEDDING_DIM: 2 }).embedBatch(['a'], false),
    );
    expect(err.retryable).toBe(false);
  });

  it.each([
    ['not an object', { raw: '"nope"' }],
    ['no data array', { json: { object: 'list' } }],
    ['too few embeddings', { json: embeddings([unit(4)]) }],
    ['embedding missing', { json: { data: [{ index: 0 }, { index: 1 }] } }],
    [
      'embedding not numbers',
      {
        json: {
          data: [
            { index: 0, embedding: ['a'] },
            { index: 1, embedding: [1, 0, 0, 0] },
          ],
        },
      },
    ],
    [
      'empty embedding',
      {
        json: {
          data: [
            { index: 0, embedding: [] },
            { index: 1, embedding: [1, 0, 0, 0] },
          ],
        },
      },
    ],
    [
      'base64 string embedding',
      {
        json: {
          data: [
            { index: 0, embedding: 'AAAA' },
            { index: 1, embedding: [1, 0, 0, 0] },
          ],
        },
      },
    ],
    [
      'duplicate index',
      {
        json: {
          data: [
            { index: 0, embedding: [1, 0, 0, 0] },
            { index: 0, embedding: [1, 0, 0, 0] },
          ],
        },
      },
    ],
    [
      'index out of range',
      {
        json: {
          data: [
            { index: 0, embedding: [1, 0, 0, 0] },
            { index: 5, embedding: [1, 0, 0, 0] },
          ],
        },
      },
    ],
  ] as [string, Reply][])(
    'rejects a response with the wrong shape: %s',
    async (_name, reply) => {
      replies.push(reply);
      const err = await failure(build().embedBatch(['a', 'b'], false));
      expect(err.retryable).toBe(false);
      expect(err.message).toMatch(/unexpected response/);
    },
  );

  it('rejects non-finite values (null from NaN/Infinity in JSON)', async () => {
    replies.push({ raw: '{"data":[{"index":0,"embedding":[1,null,0,0]}]}' });
    const err = await failure(build().embedBatch(['a'], false));
    expect(err.retryable).toBe(false);
  });

  it('treats invalid JSON in a 200 response as retryable', async () => {
    replies.push({ raw: '<html>gateway</html>' });
    const err = await failure(build().embedBatch(['a'], false));
    expect(err.retryable).toBe(true);
  });

  it('turns an error object inside a 200 response into the matching error', async () => {
    replies.push({ json: { error: { code: 402, message: 'no credits' } } });
    const err = await failure(build().embedBatch(['a'], false));
    expect(err.retryable).toBe(false);
    expect(err.status).toBe(402);
  });

  describe('HTTP errors', () => {
    it.each([
      [400, /rejected the request.*EMBEDDING_API_MODEL/s],
      [401, /rejected the API key.*EMBEDDING_API_KEY/s],
      [402, /insufficient credits.*Top up/s],
      [403, /refused access/],
      [404, /EMBEDDING_API_URL.*EMBEDDING_API_MODEL/s],
      [413, /HTTP 413/],
      [422, /HTTP 422/],
    ])('%i is permanent with a helpful message', async (status, pattern) => {
      replies.push({ status, json: { error: { message: 'provider detail' } } });
      const err = await failure(build().embedBatch(['a'], false));
      expect(err.retryable).toBe(false);
      expect(err.status).toBe(status);
      expect(err.message).toMatch(pattern);
      expect(err.message).toContain('provider detail');
      expect(requests).toHaveLength(1);
    });

    it.each([408, 425, 429, 500, 502, 503, 504])(
      '%i is retryable',
      async (status) => {
        replies.push({ status, json: {} });
        const err = await failure(build().embedBatch(['a'], false));
        expect(err.retryable).toBe(true);
        expect(err.status).toBe(status);
      },
    );

    it('waits for Retry-After and retries the request', async () => {
      replies.push(
        { status: 429, headers: { 'Retry-After': '2' }, json: {} },
        { json: embeddings([unit(4)]) },
      );

      const out = await build().embedBatch(['a'], false);

      expect(out).toEqual([unit(4)]);
      expect(sleeps).toEqual([2000]);
      expect(requests).toHaveLength(2);
    });

    it('gives up after two Retry-After retries and reports the wait to the caller', async () => {
      replies.push(
        { status: 429, headers: { 'Retry-After': '1' }, json: {} },
        { status: 429, headers: { 'Retry-After': '1' }, json: {} },
        { status: 429, headers: { 'Retry-After': '7' }, json: {} },
      );

      const err = await failure(build().embedBatch(['a'], false));

      expect(err.retryable).toBe(true);
      expect(err.status).toBe(429);
      expect(err.retryAfterMs).toBe(7000);
      expect(sleeps).toEqual([1000, 1000]);
      expect(requests).toHaveLength(3);
    });

    it('does not wait for a Retry-After that does not fit the timeout; it hands it to the queue', async () => {
      replies.push({ status: 429, headers: { 'Retry-After': '20' }, json: {} });

      const err = await failure(
        build({ EMBED_QUERY_TIMEOUT_MS: 10_000 }).embedBatch(['q'], true),
      );

      expect(err.retryable).toBe(true);
      expect(err.retryAfterMs).toBe(20_000);
      expect(sleeps).toEqual([]);
      expect(requests).toHaveLength(1);
    });

    it('does not retry a 5xx without Retry-After in-process', async () => {
      replies.push({ status: 503, json: {} });
      await failure(build().embedBatch(['a'], false));
      expect(requests).toHaveLength(1);
      expect(sleeps).toEqual([]);
    });

    it('never puts the key in an error, even when the provider echoes it', async () => {
      replies.push({
        status: 401,
        json: { error: { message: `bad key ${KEY}` } },
      });
      const err = await failure(build().embedBatch(['a'], false));
      expect(err.message).not.toContain(KEY);
      expect(err.message).toContain('***');
    });

    it('does not include the input texts in errors', async () => {
      replies.push({ status: 400, json: { error: { message: 'bad' } } });
      const err = await failure(
        build().embedBatch(['TOP-SECRET-DOCUMENT-TEXT'], false),
      );
      expect(err.message).not.toContain('TOP-SECRET');
    });
  });

  describe('network failures', () => {
    it('treats a refused connection as retryable', async () => {
      const err = await failure(
        build({ EMBEDDING_API_URL: 'http://127.0.0.1:1/v1' }).embedBatch(
          ['a'],
          false,
        ),
      );
      expect(err.retryable).toBe(true);
      expect(err.message).toMatch(/unreachable/);
      expect(err.message).not.toContain(KEY);
    });

    it('times out after the query timeout and reports it as retryable', async () => {
      replies.push({ delayMs: 1500, json: embeddings([unit(4)]) });
      const started = Date.now();

      const err = await failure(
        build({ EMBED_QUERY_TIMEOUT_MS: 300 }).embedBatch(['q'], true),
      );

      expect(Date.now() - started).toBeLessThan(1400);
      expect(err.retryable).toBe(true);
      expect(err.message).toMatch(/did not answer within 300 ms/);
    });
  });

  describe('batching', () => {
    it('defaults to 16 texts per request for documents and caps at EMBEDDING_API_BATCH_SIZE', () => {
      expect(build().batchSize).toBe(16);
      expect(build({ EMBED_BATCH_SIZE: 8 }).batchSize).toBe(8);
      expect(build({ EMBED_BATCH_SIZE: 100 }).batchSize).toBe(32);
      expect(
        build({ EMBED_BATCH_SIZE: 100, EMBEDDING_API_BATCH_SIZE: 64 })
          .batchSize,
      ).toBe(64);
      expect(
        build({ EMBED_BATCH_SIZE: 40, EMBEDDING_API_BATCH_SIZE: 10 }).batchSize,
      ).toBe(10);
      expect(build({ EMBED_BATCH_SIZE: '' }).batchSize).toBe(16);
    });

    it('splits an oversized embedBatch call into requests of at most EMBEDDING_API_BATCH_SIZE', async () => {
      const sizes: number[] = [];
      replies.push(
        ...[2, 2, 1].map((n) => ({
          json: embeddings(Array.from({ length: n }, () => unit(4))),
        })),
      );

      const out = await build({ EMBEDDING_API_BATCH_SIZE: 2 }).embedBatch(
        ['a', 'b', 'c', 'd', 'e'],
        false,
      );

      requests.forEach((r) => sizes.push(r.body.input?.length ?? 0));
      expect(sizes).toEqual([2, 2, 1]);
      expect(out).toHaveLength(5);
    });
  });

  describe('modelId and configuration', () => {
    it('derives the id from the API model and EMBEDDING_DIM, lower-cased', () => {
      expect(
        build({
          EMBEDDING_API_MODEL: 'OpenAI/Text-Embedding-3-Small',
          EMBEDDING_DIM: 1024,
        }).modelId,
      ).toBe('openai/text-embedding-3-small@1024');
    });

    it('lets EMBEDDING_MODEL_ID win', () => {
      expect(
        build({ EMBEDDING_MODEL_ID: 'qwen3-embedding-4b@1024' }).modelId,
      ).toBe('qwen3-embedding-4b@1024');
    });

    it('refuses to be built without a key or model', () => {
      expect(() => build({ EMBEDDING_API_KEY: undefined })).toThrow(
        /EMBEDDING_API_KEY/,
      );
      expect(() => build({ EMBEDDING_API_MODEL: '' })).toThrow(
        /EMBEDDING_API_MODEL/,
      );
    });

    it('defaults to the OpenRouter URL', async () => {
      const provider = build({ EMBEDDING_API_URL: undefined });
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('stop'));

      await failure(provider.embedBatch(['a'], false));

      expect(fetchSpy.mock.calls[0][0]).toBe(
        'https://openrouter.ai/api/v1/embeddings',
      );
    });
  });

  describe('probe', () => {
    it('logs when the API answers', async () => {
      replies.push({ json: embeddings([unit(4)]) });
      const log = jest.spyOn(Logger.prototype, 'log');
      await build().probe();
      expect(String(log.mock.calls[0][0])).toMatch(/ready/);
    });

    it('only warns when the API is unreachable, the key is wrong, or credits are missing', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn');
      await expect(
        build({ EMBEDDING_API_URL: 'http://127.0.0.1:1/v1' }).probe(),
      ).resolves.toBeUndefined();
      replies.push({ status: 401, json: {} });
      await expect(build().probe()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[1][0])).toMatch(/API key/);
      expect(warn.mock.calls.join('\n')).not.toContain(KEY);
    });

    it('fails the start when the vectors are too short for EMBEDDING_DIM', async () => {
      replies.push({ json: embeddings([unit(4)]) });
      await expect(build({ EMBEDDING_DIM: 8 }).probe()).rejects.toBeInstanceOf(
        EmbeddingConfigError,
      );
    });
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds, fractions and HTTP dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter('0.5')).toBe(500);
    expect(parseRetryAfter('0')).toBe(0);
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:10 GMT', now)).toBe(10_000);
    expect(parseRetryAfter('Wed, 31 Dec 2025 23:59:00 GMT', now)).toBe(0);
  });

  it('ignores missing and garbage values', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter('-5')).toBeUndefined();
  });
});

describe('EmbeddingClient with provider=api', () => {
  const config = (overrides: Record<string, unknown> = {}) =>
    createConfigServiceMock({
      EMBEDDING_PROVIDER: 'api',
      EMBEDDING_API_KEY: KEY,
      EMBEDDING_API_MODEL: 'qwen/qwen3-embedding-4b',
      EMBEDDING_DIM: 4,
      ...overrides,
    }) as unknown as ConfigService;

  it('selects the api provider and exposes modelId, provider and batchSize', () => {
    const client = new EmbeddingClient(config());
    expect(client.provider).toBe('api');
    expect(client.modelId).toBe('qwen/qwen3-embedding-4b@4');
    expect(client.batchSize).toBe(16);
    expect(client.dim).toBe(4);
  });

  it('does not touch AI_WORKER_URL (the worker is not needed)', () => {
    const cfg = config({ AI_WORKER_URL: undefined });
    expect(() => new EmbeddingClient(cfg)).not.toThrow();
  });

  it('probes only outside tests', async () => {
    const cfg = config();
    const client = new EmbeddingClient(cfg);
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('x'));
    await client.onModuleInit(); // NODE_ENV=test under jest
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
