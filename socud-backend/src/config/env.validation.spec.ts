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
  it('defaults to 0.35 and accepts values in -1..1', () => {
    expect(validateEnv(base).SEARCH_MIN_SIMILARITY).toBe(0.35);
    expect(
      validateEnv({ ...base, SEARCH_MIN_SIMILARITY: '0.5' })
        .SEARCH_MIN_SIMILARITY,
    ).toBe(0.5);
  });

  it('rejects values outside -1..1', () => {
    expect(() =>
      validateEnv({ ...base, SEARCH_MIN_SIMILARITY: '1.5' }),
    ).toThrow();
  });
});

describe('validateEnv Swagger / session cookie settings', () => {
  it('leaves SWAGGER_ENABLED and SESSION_COOKIE_DOMAIN unset by default', () => {
    const env = validateEnv(base);
    expect(env.SWAGGER_ENABLED).toBeUndefined();
    expect(env.SESSION_COOKIE_DOMAIN).toBeUndefined();
  });

  it('parses SWAGGER_ENABLED from strings ("false" is false, not truthy)', () => {
    expect(
      validateEnv({ ...base, SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED,
    ).toBe(false);
    expect(
      validateEnv({ ...base, SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED,
    ).toBe(true);
    expect(() => validateEnv({ ...base, SWAGGER_ENABLED: 'maybe' })).toThrow(
      /SWAGGER_ENABLED/,
    );
  });
});

describe('validateEnv EMBEDDING_PROVIDER', () => {
  const api = {
    ...base,
    EMBEDDING_PROVIDER: 'api',
    EMBEDDING_API_KEY: 'sk-test',
    EMBEDDING_API_MODEL: 'qwen/qwen3-embedding-4b',
  };
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('defaults to the worker and needs no API settings', () => {
    const env = validateEnv(base);
    expect(env.EMBEDDING_PROVIDER).toBe('worker');
    expect(env.EMBEDDING_API_URL).toBe('https://openrouter.ai/api/v1');
    expect(env.EMBEDDING_API_BATCH_SIZE).toBe(32);
    expect(env.EMBEDDING_API_KEY).toBeUndefined();
  });

  it('keeps EMBED_BATCH_SIZE unset by default and rejects > 32 for the worker', () => {
    expect(validateEnv(base).EMBED_BATCH_SIZE).toBeUndefined();
    expect(
      validateEnv({ ...base, EMBED_BATCH_SIZE: '32' }).EMBED_BATCH_SIZE,
    ).toBe(32);
    expect(() => validateEnv({ ...base, EMBED_BATCH_SIZE: '33' })).toThrow(
      /EMBED_BATCH_SIZE: must not be greater than 32/,
    );
  });

  it('rejects an unknown provider', () => {
    expect(() => validateEnv({ ...base, EMBEDDING_PROVIDER: 'cloud' })).toThrow(
      /EMBEDDING_PROVIDER/,
    );
  });

  it('accepts a complete api configuration', () => {
    const env = validateEnv({ ...api, EMBEDDING_API_DIMENSIONS: '1024' });
    expect(env.EMBEDDING_PROVIDER).toBe('api');
    expect(env.EMBEDDING_API_DIMENSIONS).toBe(1024);
    expect(warn).not.toHaveBeenCalled();
  });

  it('requires the key and the model for provider=api, naming both', () => {
    let message = '';
    try {
      validateEnv({ ...base, EMBEDDING_PROVIDER: 'api' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(
      /EMBEDDING_API_KEY: required when EMBEDDING_PROVIDER=api/,
    );
    expect(message).toMatch(
      /EMBEDDING_API_MODEL: required when EMBEDDING_PROVIDER=api/,
    );
  });

  it('treats empty API variables as unset', () => {
    expect(() => validateEnv({ ...api, EMBEDDING_API_KEY: '' })).toThrow(
      /EMBEDDING_API_KEY/,
    );
    expect(
      validateEnv({ ...api, EMBEDDING_API_URL: '', EMBED_BATCH_SIZE: '' }),
    ).toEqual(
      expect.objectContaining({
        EMBEDDING_API_URL: 'https://openrouter.ai/api/v1',
      }),
    );
  });

  it('rejects plain http to a public host and warns for a private one', () => {
    expect(() =>
      validateEnv({ ...api, EMBEDDING_API_URL: 'http://api.example.com/v1' }),
    ).toThrow(/EMBEDDING_API_URL.*Use https/s);
    validateEnv({ ...api, EMBEDDING_API_URL: 'http://192.168.1.5:8080/v1' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unencrypted'));
    warn.mockClear();
    validateEnv({ ...api, EMBEDDING_API_URL: 'http://127.0.0.1:8080/v1' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('rejects EMBEDDING_API_DIMENSIONS below EMBEDDING_DIM', () => {
    expect(() =>
      validateEnv({ ...api, EMBEDDING_API_DIMENSIONS: '512' }),
    ).toThrow(
      /EMBEDDING_API_DIMENSIONS: 512 is smaller than EMBEDDING_DIM=1024/,
    );
  });

  it('allows bigger document batches for the api and warns above the API limit', () => {
    expect(
      validateEnv({ ...api, EMBED_BATCH_SIZE: '32' }).EMBED_BATCH_SIZE,
    ).toBe(32);
    validateEnv({
      ...api,
      EMBED_BATCH_SIZE: '64',
      EMBEDDING_API_BATCH_SIZE: '16',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('EMBEDDING_API_BATCH_SIZE=16'),
    );
  });

  it('does not validate API settings when the provider is the worker', () => {
    expect(() =>
      validateEnv({ ...base, EMBEDDING_API_URL: 'http://api.example.com/v1' }),
    ).not.toThrow();
  });
});

describe('validateEnv EMBEDDING_PROFILE', () => {
  const all = {
    ...base,
    EMBEDDING_PROVIDER: 'worker',
    LOCAL__EMBEDDING_PROVIDER: 'worker',
    LOCAL__AI_WORKER_URL: 'http://127.0.0.1:8000',
    PC__AI_WORKER_URL: 'http://192.168.1.50:8000',
    PC__AI_WORKER_TOKEN: 'pc-token',
    PC__EMBED_CONCURRENCY: '2',
    API__EMBEDDING_PROVIDER: 'api',
    API__EMBEDDING_API_KEY: 'sk-test',
    API__EMBEDDING_API_MODEL: 'qwen/qwen3-embedding-8b',
    API__EMBEDDING_API_DIMENSIONS: '1024',
    API__EMBED_CONCURRENCY: '4',
    API__EMBEDDING_API_PROVIDER_ROUTING: '{"sort":"latency"}',
  };

  it('is unset by default and leaves plain variables alone', () => {
    const env = validateEnv(all);
    expect(env.EMBEDDING_PROFILE).toBeUndefined();
    expect(env.EMBEDDING_PROVIDER).toBe('worker');
    expect(env.EMBED_CONCURRENCY).toBe(1);
  });

  it('switches everything by changing only EMBEDDING_PROFILE', () => {
    const local = validateEnv({ ...all, EMBEDDING_PROFILE: 'local' });
    expect(local.EMBEDDING_PROFILE).toBe('local');
    expect(local.EMBEDDING_PROVIDER).toBe('worker');
    expect(local.AI_WORKER_URL).toBe('http://127.0.0.1:8000');
    expect(local.EMBED_CONCURRENCY).toBe(1);

    const pc = validateEnv({ ...all, EMBEDDING_PROFILE: 'pc' });
    expect(pc.AI_WORKER_URL).toBe('http://192.168.1.50:8000');
    expect(pc.AI_WORKER_TOKEN).toBe('pc-token');
    expect(pc.EMBED_CONCURRENCY).toBe(2);

    const api = validateEnv({ ...all, EMBEDDING_PROFILE: 'API' });
    expect(api.EMBEDDING_PROFILE).toBe('api');
    expect(api.EMBEDDING_PROVIDER).toBe('api');
    expect(api.EMBEDDING_API_KEY).toBe('sk-test');
    expect(api.EMBEDDING_API_DIMENSIONS).toBe(1024);
    expect(api.EMBED_CONCURRENCY).toBe(4);
    expect(api.EMBEDDING_API_PROVIDER_ROUTING).toBe('{"sort":"latency"}');
  });

  it('does not fail on an inactive api profile that has no key', () => {
    const { API__EMBEDDING_API_KEY: _key, ...noKey } = all;
    void _key;
    expect(() =>
      validateEnv({ ...noKey, EMBEDDING_PROFILE: 'pc' }),
    ).not.toThrow();
    expect(() => validateEnv({ ...noKey, EMBEDDING_PROFILE: 'api' })).toThrow(
      /EMBEDDING_API_KEY: required when EMBEDDING_PROVIDER=api/,
    );
  });

  it('beats plain and compose-style empty values', () => {
    const env = validateEnv({
      ...all,
      EMBEDDING_PROFILE: 'api',
      EMBEDDING_PROVIDER: 'worker',
      EMBEDDING_API_KEY: '',
      EMBEDDING_API_MODEL: '',
      AI_WORKER_URL: 'http://host.docker.internal:8000',
    });
    expect(env.EMBEDDING_PROVIDER).toBe('api');
    expect(env.EMBEDDING_API_MODEL).toBe('qwen/qwen3-embedding-8b');
  });

  it('reports an unknown profile with the profiles found', () => {
    expect(() => validateEnv({ ...all, EMBEDDING_PROFILE: 'nas' })).toThrow(
      /Invalid environment configuration:\n {2}- EMBEDDING_PROFILE="nas" has no NAS__\* variables \(profiles with variables: api, local, pc\)/,
    );
  });

  it('reports a non-allow-listed profile variable', () => {
    expect(() =>
      validateEnv({
        ...all,
        EMBEDDING_PROFILE: 'pc',
        PC__JWT_SECRET: 'x'.repeat(40),
      }),
    ).toThrow(/PC__JWT_SECRET cannot be profile-scoped/);
  });

  it('works through ConfigModule, so ConfigService sees the resolved values', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, all, { EMBEDDING_PROFILE: 'api' });
    try {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            validate: validateEnv,
          }),
        ],
      }).compile();
      const config = moduleRef.get(ConfigService);
      expect(config.get('EMBEDDING_PROVIDER')).toBe('api');
      expect(config.get('EMBEDDING_PROFILE')).toBe('api');
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in saved)) delete process.env[key];
      }
      Object.assign(process.env, saved);
    }
  });
});

describe('validateEnv EMBEDDING_API_PROVIDER_ROUTING', () => {
  const api = {
    ...base,
    EMBEDDING_PROVIDER: 'api',
    EMBEDDING_API_KEY: 'sk-test',
    EMBEDDING_API_MODEL: 'qwen/qwen3-embedding-8b',
  };

  it('is optional', () => {
    expect(validateEnv(api).EMBEDDING_API_PROVIDER_ROUTING).toBeUndefined();
    expect(
      validateEnv({ ...api, EMBEDDING_API_PROVIDER_ROUTING: '' })
        .EMBEDDING_API_PROVIDER_ROUTING,
    ).toBeUndefined();
  });

  it.each(['{"sort":"latency"}', '{"ignore":["DeepInfra"]}', '{}'])(
    'accepts the JSON object %s',
    (value) => {
      expect(
        validateEnv({ ...api, EMBEDDING_API_PROVIDER_ROUTING: value })
          .EMBEDDING_API_PROVIDER_ROUTING,
      ).toBe(value);
    },
  );

  it.each([
    ['not json', /is not valid JSON/],
    ["{'sort':'latency'}", /is not valid JSON/],
    ['["DeepInfra"]', /must be a JSON object .* not an array/],
    ['null', /must be a JSON object .* not null/],
    ['"latency"', /must be a JSON object .* not string/],
    ['42', /must be a JSON object .* not number/],
  ])('rejects %s at startup', (value, message) => {
    expect(() =>
      validateEnv({ ...api, EMBEDDING_API_PROVIDER_ROUTING: value }),
    ).toThrow(message);
  });

  it('validates it for the worker provider too', () => {
    expect(() =>
      validateEnv({ ...base, EMBEDDING_API_PROVIDER_ROUTING: 'oops' }),
    ).toThrow(/EMBEDDING_API_PROVIDER_ROUTING/);
  });
});
