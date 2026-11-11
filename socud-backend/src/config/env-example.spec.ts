import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { validateEnv } from './env.validation';

/** The shipped example files must stay valid: every profile block works by changing only EMBEDDING_PROFILE. */
const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'a'.repeat(36),
};
const load = (relative: string) =>
  parseEnv(readFileSync(resolve(__dirname, '../../..', relative), 'utf8'));

describe.each([
  ['socud-backend/.env.example', 'http://127.0.0.1:8000'],
  ['.env.example', 'http://host.docker.internal:8000'],
])('%s embedding profiles', (file, localUrl) => {
  const example = load(file);
  // Values the user fills in; an unselected block may keep them empty (that is tested last).
  const filled = {
    ...example,
    PC__AI_WORKER_TOKEN: 'pc-token',
    API__EMBEDDING_API_KEY: 'sk-test',
  };

  it('defaults to the local profile', () => {
    expect(example.EMBEDDING_PROFILE).toBe('local');
  });

  it('local: worker, batch 1, one job, 180 s', () => {
    const env = validateEnv({ ...filled, ...base, EMBEDDING_PROFILE: 'local' });
    expect(env.EMBEDDING_PROVIDER).toBe('worker');
    expect(env.AI_WORKER_URL).toBe(localUrl);
    expect(env.EMBED_BATCH_SIZE).toBe(1);
    expect(env.EMBED_CONCURRENCY).toBe(1);
    expect(env.EMBED_TIMEOUT_MS).toBe(180000);
  });

  it('pc: worker on the LAN with a token, batch 1, two jobs', () => {
    const env = validateEnv({ ...filled, ...base, EMBEDDING_PROFILE: 'pc' });
    expect(env.EMBEDDING_PROVIDER).toBe('worker');
    expect(env.AI_WORKER_URL).toBe('http://192.168.1.50:8000');
    expect(env.AI_WORKER_TOKEN).toBe('pc-token');
    expect(env.EMBED_BATCH_SIZE).toBe(1);
    expect(env.EMBED_CONCURRENCY).toBe(2);
  });

  it('api: OpenRouter 8B at 1024 dims, 30 s, four jobs, latency routing', () => {
    const env = validateEnv({ ...filled, ...base, EMBEDDING_PROFILE: 'api' });
    expect(env.EMBEDDING_PROVIDER).toBe('api');
    expect(env.EMBEDDING_API_URL).toBe('https://openrouter.ai/api/v1');
    expect(env.EMBEDDING_API_MODEL).toBe('qwen/qwen3-embedding-8b');
    expect(env.EMBEDDING_API_DIMENSIONS).toBe(1024);
    expect(env.EMBED_TIMEOUT_MS).toBe(30000);
    expect(env.EMBED_CONCURRENCY).toBe(4);
    expect(JSON.parse(env.EMBEDDING_API_PROVIDER_ROUTING ?? 'null')).toEqual({
      sort: 'latency',
    });
  });

  it('an unselected api block with an empty key does not break the other profiles', () => {
    for (const profile of ['local', 'pc']) {
      expect(() =>
        validateEnv({ ...example, ...base, EMBEDDING_PROFILE: profile }),
      ).not.toThrow();
    }
    expect(() =>
      validateEnv({ ...example, ...base, EMBEDDING_PROFILE: 'api' }),
    ).toThrow(/EMBEDDING_API_KEY: required/);
  });
});
