import {
  applyEmbeddingProfile,
  isProfileScopedVar,
  profileEnvPrefix,
} from './embedding-profile';

/** The three-profile .env of the README, all blocks present at once. */
const ALL = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  EMBEDDING_PROVIDER: 'worker',
  EMBED_BATCH_SIZE: '4',
  LOCAL__EMBEDDING_PROVIDER: 'worker',
  LOCAL__AI_WORKER_URL: 'http://127.0.0.1:8000',
  LOCAL__EMBED_BATCH_SIZE: '1',
  PC__EMBEDDING_PROVIDER: 'worker',
  PC__AI_WORKER_URL: 'http://192.168.1.50:8000',
  PC__AI_WORKER_TOKEN: 'pc-token',
  API__EMBEDDING_PROVIDER: 'api',
  API__EMBEDDING_API_KEY: 'sk-secret',
  API__EMBEDDING_API_MODEL: 'qwen/qwen3-embedding-8b',
};

describe('applyEmbeddingProfile', () => {
  it('returns the input unchanged without a profile (unset, empty, blank)', () => {
    for (const value of [undefined, '', '   ']) {
      const env = { ...ALL, EMBEDDING_PROFILE: value };
      const out = applyEmbeddingProfile(env);
      expect(out.profile).toBeNull();
      expect(out.applied).toEqual([]);
      expect(out.env).toBe(env);
      expect(out.env.EMBEDDING_PROVIDER).toBe('worker');
    }
  });

  it('does nothing for an environment without any profile variables', () => {
    const env = { DATABASE_URL: 'x', EMBEDDING_PROVIDER: 'api' };
    expect(applyEmbeddingProfile(env)).toEqual({
      env,
      profile: null,
      applied: [],
    });
  });

  it('lets the active profile override plain variables', () => {
    const { env, profile, applied } = applyEmbeddingProfile({
      ...ALL,
      EMBEDDING_PROFILE: 'local',
      AI_WORKER_URL: 'http://host.docker.internal:8000',
    });
    expect(profile).toBe('local');
    expect(env.EMBED_BATCH_SIZE).toBe('1'); // plain 4 overridden
    expect(env.AI_WORKER_URL).toBe('http://127.0.0.1:8000');
    expect(applied).toEqual([
      'AI_WORKER_URL',
      'EMBEDDING_PROVIDER',
      'EMBED_BATCH_SIZE',
    ]);
  });

  it('overrides empty plain values (what docker compose passes for unset variables)', () => {
    const { env } = applyEmbeddingProfile({
      ...ALL,
      EMBEDDING_PROFILE: 'api',
      EMBEDDING_PROVIDER: 'worker',
      EMBEDDING_API_KEY: '',
      EMBEDDING_API_MODEL: '',
    });
    expect(env.EMBEDDING_PROVIDER).toBe('api');
    expect(env.EMBEDDING_API_KEY).toBe('sk-secret');
    expect(env.EMBEDDING_API_MODEL).toBe('qwen/qwen3-embedding-8b');
  });

  it('lets an explicitly empty profile variable blank a plain value', () => {
    const { env } = applyEmbeddingProfile({
      EMBEDDING_PROFILE: 'a',
      EMBED_BATCH_SIZE: '4',
      A__EMBED_BATCH_SIZE: '',
    });
    expect(env.EMBED_BATCH_SIZE).toBe('');
  });

  it('keeps plain variables the profile does not mention', () => {
    const { env } = applyEmbeddingProfile({
      ...ALL,
      EMBEDDING_PROFILE: 'pc',
      EMBED_TIMEOUT_MS: '99000',
    });
    expect(env.EMBED_TIMEOUT_MS).toBe('99000');
    expect(env.AI_WORKER_TOKEN).toBe('pc-token');
  });

  it('ignores the variables of inactive profiles entirely', () => {
    const { env } = applyEmbeddingProfile({
      ...ALL,
      EMBEDDING_PROFILE: 'local',
      // an inactive profile may even be broken: not allow-listed, no key
      PC__JWT_SECRET: 'nope',
      API__EMBEDDING_API_KEY: '',
    });
    expect(env.EMBEDDING_PROVIDER).toBe('worker');
    expect(env.EMBEDDING_API_KEY).toBeUndefined();
    expect(env.AI_WORKER_TOKEN).toBeUndefined();
  });

  it('normalises the name: case, whitespace, "-" becomes "_" in the prefix', () => {
    const base = { MY_PC__AI_WORKER_URL: 'http://10.0.0.2:8000' };
    for (const name of ['my-pc', ' My-Pc ', 'MY-PC']) {
      const out = applyEmbeddingProfile({ ...base, EMBEDDING_PROFILE: name });
      expect(out.profile).toBe('my-pc');
      expect(out.env.AI_WORKER_URL).toBe('http://10.0.0.2:8000');
      expect(out.env.EMBEDDING_PROFILE).toBe('my-pc');
    }
    expect(profileEnvPrefix('my-pc')).toBe('MY_PC');
    expect(profileEnvPrefix('lm_studio2')).toBe('LM_STUDIO2');
  });

  it('does not mutate its input', () => {
    const input = { ...ALL, EMBEDDING_PROFILE: 'api' };
    const copy = { ...input };
    applyEmbeddingProfile(input);
    expect(input).toEqual(copy);
  });

  it('rejects an invalid profile name', () => {
    for (const name of ['my pc', 'a.b', '-x', 'ü', 'a/b']) {
      expect(() =>
        applyEmbeddingProfile({ EMBEDDING_PROFILE: name, X__EMBED_X: '1' }),
      ).toThrow(/not a valid profile name/);
    }
  });

  it('rejects a profile without variables and lists the profiles that exist', () => {
    expect(() =>
      applyEmbeddingProfile({ ...ALL, EMBEDDING_PROFILE: 'cloud' }),
    ).toThrow(
      /EMBEDDING_PROFILE="cloud" has no CLOUD__\* variables \(profiles with variables: api, local, pc\)/,
    );
  });

  it('says so when no profile is defined at all', () => {
    expect(() =>
      applyEmbeddingProfile({ EMBEDDING_PROFILE: 'api', HOME: '/h' }),
    ).toThrow(/no profile variables .* are set at all/);
  });

  it('rejects a profile variable outside the embedding/search allow-list', () => {
    for (const name of [
      'JWT_SECRET',
      'DATABASE_URL',
      'PORT',
      'EMBEDDING_PROFILE',
      'embedding_api_key',
    ]) {
      expect(() =>
        applyEmbeddingProfile({
          EMBEDDING_PROFILE: 'api',
          API__EMBEDDING_PROVIDER: 'api',
          [`API__${name}`]: 'x',
        }),
      ).toThrow(/API__.* cannot be profile-scoped/);
    }
  });

  it('never puts a value into an error message', () => {
    try {
      applyEmbeddingProfile({
        EMBEDDING_PROFILE: 'api',
        API__JWT_SECRET: 'super-secret-value',
        API__EMBEDDING_API_KEY: 'sk-secret-key',
      });
      throw new Error('expected a throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain('super-secret-value');
      expect(message).not.toContain('sk-secret-key');
    }
  });

  it('does not mistake unrelated double-underscore variables for profiles', () => {
    const env = { __CF_USER_TEXT_ENCODING: '0x1F5:0:0', npm_config__x: '1' };
    expect(() =>
      applyEmbeddingProfile({ ...env, EMBEDDING_PROFILE: 'api' }),
    ).toThrow(/no profile variables/);
  });
});

describe('isProfileScopedVar', () => {
  it.each([
    'EMBEDDING_PROVIDER',
    'EMBEDDING_API_KEY',
    'EMBEDDING_API_PROVIDER_ROUTING',
    'EMBEDDING_DIM',
    'EMBED_BATCH_SIZE',
    'EMBED_CONCURRENCY',
    'AI_WORKER_URL',
    'AI_WORKER_TOKEN',
    'SEARCH_MIN_SIMILARITY',
  ])('allows %s', (name) => expect(isProfileScopedVar(name)).toBe(true));

  it.each([
    'EMBEDDING_PROFILE',
    'JWT_SECRET',
    'DATABASE_URL',
    'REDIS_URL',
    'NODE_ENV',
    'LOG_LEVEL',
    'EMBEDDINGS',
  ])('rejects %s', (name) => expect(isProfileScopedVar(name)).toBe(false));
});
