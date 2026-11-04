import 'reflect-metadata';
import { validateEnv } from './env.validation';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'a'.repeat(36),
  JWT_REFRESH_SECRET: 'b'.repeat(36),
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
