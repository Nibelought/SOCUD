import { Writable } from 'stream';
import pino from 'pino';
import type { IncomingMessage, ServerResponse } from 'http';
import {
  REDACT_PATHS,
  REDACTED,
  buildLoggerParams,
  generateRequestId,
  isQuietRoute,
} from './logger.config';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const logger = pino(
    { redact: { paths: REDACT_PATHS, censor: REDACTED } },
    stream,
  );
  return { logger, output: () => lines.join('') };
}

describe('log redaction', () => {
  it('redacts credentials in request/response headers', () => {
    const { logger, output } = capture();
    logger.info({
      req: {
        headers: {
          authorization: 'Bearer secret-jwt',
          cookie: 'refresh_token=secret-cookie',
          'x-worker-token': 'secret-worker',
          'user-agent': 'jest',
        },
      },
      res: { headers: { 'set-cookie': ['refresh_token=secret-set-cookie'] } },
    });
    const out = output();
    for (const secret of [
      'secret-jwt',
      'secret-cookie',
      'secret-worker',
      'secret-set-cookie',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('jest');
    expect(out).toContain(REDACTED);
  });

  it('redacts password and token fields at top level and one level deep', () => {
    const { logger, output } = capture();
    logger.info({
      password: 'pw-top',
      refreshToken: 'rt-top',
      body: { password: 'pw-nested', accessToken: 'at-nested', email: 'a@b.c' },
      user: { passwordHash: '$2b$10$hash' },
    });
    const out = output();
    for (const secret of [
      'pw-top',
      'rt-top',
      'pw-nested',
      'at-nested',
      '$2b$10$hash',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('a@b.c');
  });
});

describe('buildLoggerParams', () => {
  const pinoHttp = (env: Parameters<typeof buildLoggerParams>[0]) =>
    buildLoggerParams(env).pinoHttp as {
      level: string;
      transport?: unknown;
      redact: { paths: string[] };
    };

  it('defaults to info in production and silent in tests', () => {
    expect(pinoHttp({ NODE_ENV: 'production' }).level).toBe('info');
    expect(pinoHttp({ NODE_ENV: 'test' }).level).toBe('silent');
  });

  it('honours LOG_LEVEL', () => {
    expect(pinoHttp({ NODE_ENV: 'production', LOG_LEVEL: 'warn' }).level).toBe(
      'warn',
    );
  });

  it('never enables pretty printing in production', () => {
    expect(pinoHttp({ NODE_ENV: 'production' }).transport).toBeUndefined();
  });

  it('wires the redaction paths', () => {
    expect(pinoHttp({ NODE_ENV: 'production' }).redact.paths).toBe(
      REDACT_PATHS,
    );
  });
});

describe('request ids', () => {
  const run = (header?: string | string[]) => {
    const setHeader = jest.fn();
    const id = generateRequestId(
      { headers: { 'x-request-id': header } } as unknown as IncomingMessage,
      { setHeader } as unknown as ServerResponse,
    );
    return { id, setHeader };
  };

  it('reuses a well-formed inbound id and echoes it back', () => {
    const { id, setHeader } = run('abc-123.DEF_4');
    expect(id).toBe('abc-123.DEF_4');
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', id);
  });

  it.each([undefined, 'has spaces', 'x'.repeat(65), 'bad\nheader'])(
    'generates a UUID instead of %p',
    (header) => {
      expect(run(header).id).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it('skips health probes in request logging', () => {
    expect(isQuietRoute({ url: '/health' } as IncomingMessage)).toBe(true);
    expect(isQuietRoute({ url: '/documents' } as IncomingMessage)).toBe(false);
  });
});
