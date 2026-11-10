import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Params } from 'nestjs-pino';

export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Placeholder written instead of a redacted value. */
export const REDACTED = '[REDACTED]';

/**
 * Paths whose values never reach the logs. Covers HTTP headers (credentials, cookies, the AI worker
 * token) and credential-like fields at the top level and one level deep (request bodies, error
 * contexts, objects logged by services).
 */
export const REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-worker-token"]',
  'res.headers["set-cookie"]',
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.authorization',
  '*.cookie',
  '*.secret',
  '*.apiKey',
];

/** Reuses a well-formed inbound request id (from a trusted proxy) or generates one. */
export function generateRequestId(
  req: IncomingMessage,
  res: ServerResponse,
): string {
  const inbound = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
  const id =
    candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

function canResolve(moduleName: string): boolean {
  try {
    require.resolve(moduleName);
    return true;
  } catch {
    return false;
  }
}

export interface LoggerEnv {
  LOG_LEVEL?: string;
  NODE_ENV?: string;
}

/** Health probes run every few seconds and would drown the logs. */
export const isQuietRoute = (req: IncomingMessage): boolean =>
  req.url === '/health' || req.url?.startsWith('/health?') === true;

export function buildLoggerParams(env: LoggerEnv): Params {
  const isProduction = env.NODE_ENV === 'production';
  const isTest = env.NODE_ENV === 'test';
  // pino-pretty is a devDependency: only use it where it is installed and not in production.
  const pretty = env.NODE_ENV === 'development' && canResolve('pino-pretty');

  return {
    pinoHttp: {
      level:
        env.LOG_LEVEL ?? (isTest ? 'silent' : isProduction ? 'info' : 'debug'),
      genReqId: generateRequestId,
      redact: { paths: REDACT_PATHS, censor: REDACTED },
      autoLogging: { ignore: isQuietRoute },
      ...(pretty
        ? {
            transport: {
              target: 'pino-pretty',
              options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l' },
            },
          }
        : {}),
    },
  };
}
