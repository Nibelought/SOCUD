import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

import { LOG_LEVELS } from '../observability/logger.config';

export const NODE_ENVIRONMENTS = ['development', 'production', 'test'] as const;

/**
 * Typed contract of the environment variables the backend reads.
 * Validated once at boot by ConfigModule (see `validateEnv`).
 */
export class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters long' })
  JWT_SECRET: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  WS_PORT: number = 3002;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  AI_WORKER_URL: string = 'http://127.0.0.1:8000';

  /** Shared secret sent as `X-Worker-Token` to the AI worker; must match the worker's WORKER_TOKEN. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  AI_WORKER_TOKEN?: string;

  /** Minimum interval between access re-validations of one Hocuspocus connection, in ms. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ACCESS_RECHECK_MS: number = 15000;

  /** Debounce before Hocuspocus persists a changed document, in ms. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  WS_STORE_DEBOUNCE_MS: number = 2000;

  /** Comma-separated list of allowed origins. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  CORS_ORIGIN: string = 'http://localhost:3001';

  /** pino log level; defaults to info in production, debug otherwise, silent in tests. */
  @IsOptional()
  @IsIn(LOG_LEVELS)
  LOG_LEVEL?: (typeof LOG_LEVELS)[number];

  /** Enables Sentry error reporting when set. Leave unset to disable. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  SENTRY_DSN?: string;

  /** Fraction (0..1) of requests sampled for Sentry performance traces; 0 disables tracing. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  SENTRY_TRACES_SAMPLE_RATE: number = 0;

  @IsOptional()
  @IsIn(NODE_ENVIRONMENTS)
  NODE_ENV: (typeof NODE_ENVIRONMENTS)[number] = 'development';
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  // Treat empty strings (e.g. `PORT=` in .env) as "not set" so defaults apply.
  const cleaned = Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== ''),
  );

  const validated = plainToInstance(EnvironmentVariables, cleaned, {
    exposeDefaultValues: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: false,
  });

  const problems = errors.flatMap((error) =>
    Object.values(error.constraints ?? {}).map(
      (message) => `  - ${error.property}: ${message}`,
    ),
  );

  if (problems.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${problems.join('\n')}\n` +
        'See socud-backend/.env.example for the expected variables.',
    );
  }

  return validated;
}

export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
