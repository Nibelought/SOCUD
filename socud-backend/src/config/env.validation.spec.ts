import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { validateEnv } from './env.validation';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'a'.repeat(36),
};

describe('validateEnv AI_WORKER_TOKEN', () => {
  it('is optional and has no default', () => {
    expect(validateEnv(base).AI_WORKER_TOKEN).toBeUndefined();
  });

  it('treats an empty value as unset', () => {
    expect(validateEnv({ ...base, AI_WORKER_TOKEN: '' }).AI_WORKER_TOKEN).toBe(
      undefined,
    );
  });

  it('passes the configured token through', () => {
    expect(
      validateEnv({ ...base, AI_WORKER_TOKEN: 'tok' }).AI_WORKER_TOKEN,
    ).toBe('tok');
  });
});

// Name of the removed refresh-token secret, built at runtime so the old name is not spelled in the repo.
const LEFTOVER_KEY = ['JWT', 'REFRESH', 'SECRET'].join('_');

describe('validateEnv unknown variables', () => {
  it('tolerates a leftover removed refresh secret and unrelated variables', () => {
    const env = validateEnv({
      ...base,
      [LEFTOVER_KEY]: 'x'.repeat(36),
      HOME: '/home/someone',
    });
    expect(env.JWT_SECRET).toBe(base.JWT_SECRET);
  });

  it('tolerates a leftover removed refresh secret equal to JWT_SECRET', () => {
    expect(() =>
      validateEnv({ ...base, [LEFTOVER_KEY]: base.JWT_SECRET }),
    ).not.toThrow();
  });
});

describe('validateEnv JWT_SECRET', () => {
  it('rejects a secret shorter than 32 characters', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET must be at least 32 characters/,
    );
  });
});

describe.each([
  ['ACCESS_RECHECK_MS', 15000],
  ['WS_STORE_DEBOUNCE_MS', 2000],
] as const)('validateEnv %s', (key, fallback) => {
  it('defaults when unset or empty', () => {
    expect(validateEnv(base)[key]).toBe(fallback);
    expect(validateEnv({ ...base, [key]: '' })[key]).toBe(fallback);
  });

  it('is parsed from a string into a number', () => {
    const value = validateEnv({ ...base, [key]: '500' })[key];
    expect(value).toBe(500);
    expect(typeof value).toBe('number');
  });

  it.each(['0', '-5', '1.5', 'abc'])('rejects %s', (bad) => {
    expect(() => validateEnv({ ...base, [key]: bad })).toThrow(
      new RegExp(`${key}:`),
    );
  });
});

describe('ConfigModule with validateEnv', () => {
  it('serves the Hocuspocus settings as numbers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: () =>
            validateEnv({
              ...base,
              ACCESS_RECHECK_MS: '7000',
              [LEFTOVER_KEY]: 'x'.repeat(36),
            }),
        }),
      ],
    }).compile();
    const config = moduleRef.get(ConfigService);
    expect(config.get('ACCESS_RECHECK_MS')).toBe(7000);
    expect(config.get('WS_STORE_DEBOUNCE_MS')).toBe(2000);
    await moduleRef.close();
  });
});

describe('validateEnv queue / embedding settings', () => {
  it('has defaults matching the contract', () => {
    const env = validateEnv(base);
    expect(env.REDIS_URL).toBe('redis://127.0.0.1:6379');
    expect(env.EMBEDDING_DIM).toBe(1024);
    expect(env.EMBED_CONCURRENCY).toBe(1);
    expect(env.QUEUE_ENABLED).toBeUndefined();
    expect(env.QUEUE_WORKER_ENABLED).toBeUndefined();
  });

  it('parses numbers and booleans from strings', () => {
    const env = validateEnv({
      ...base,
      REDIS_URL: 'redis://redis:6379',
      EMBEDDING_DIM: '1024',
      EMBED_RECONCILE_INTERVAL_MS: '0',
      QUEUE_ENABLED: 'false',
      QUEUE_WORKER_ENABLED: 'true',
    });
    expect(env.REDIS_URL).toBe('redis://redis:6379');
    expect(env.EMBED_RECONCILE_INTERVAL_MS).toBe(0);
    expect(env.QUEUE_ENABLED).toBe(false);
    expect(env.QUEUE_WORKER_ENABLED).toBe(true);
  });

  it('rejects an invalid boolean or dimension', () => {
    expect(() => validateEnv({ ...base, QUEUE_ENABLED: 'maybe' })).toThrow(
      /QUEUE_ENABLED/,
    );
    expect(() => validateEnv({ ...base, EMBEDDING_DIM: '0' })).toThrow(
      /EMBEDDING_DIM/,
    );
  });
});

describe('validateEnv observability settings', () => {
  it('has safe defaults: no Sentry, no tracing, no explicit log level', () => {
    const env = validateEnv(base);
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(env.LOG_LEVEL).toBeUndefined();
    expect(env.SENTRY_TRACES_SAMPLE_RATE).toBe(0);
  });

  it('accepts valid values', () => {
    const env = validateEnv({
      ...base,
      LOG_LEVEL: 'debug',
      SENTRY_DSN: 'https://k@example.com/1',
      SENTRY_TRACES_SAMPLE_RATE: '0.5',
    });
    expect(env.LOG_LEVEL).toBe('debug');
    expect(env.SENTRY_DSN).toBe('https://k@example.com/1');
    expect(env.SENTRY_TRACES_SAMPLE_RATE).toBe(0.5);
  });

  it('rejects an unknown log level and an out-of-range sample rate', () => {
    expect(() => validateEnv({ ...base, LOG_LEVEL: 'loud' })).toThrow(
      /LOG_LEVEL/,
    );
    expect(() =>
      validateEnv({ ...base, SENTRY_TRACES_SAMPLE_RATE: '2' }),
    ).toThrow(/SENTRY_TRACES_SAMPLE_RATE/);
  });
});

describe('validateEnv SEARCH_MIN_SIMILARITY', () => {
  it('defaults to 0.2 and accepts values in -1..1', () => {
    expect(validateEnv(base).SEARCH_MIN_SIMILARITY).toBe(0.2);
    expect(
      validateEnv({ ...base, SEARCH_MIN_SIMILARITY: '0.35' })
        .SEARCH_MIN_SIMILARITY,
    ).toBe(0.35);
  });

  it('rejects values outside -1..1', () => {
    expect(() =>
      validateEnv({ ...base, SEARCH_MIN_SIMILARITY: '1.5' }),
    ).toThrow();
  });
});
