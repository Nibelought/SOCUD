import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export const NODE_ENVIRONMENTS = ['development', 'production', 'test'] as const;

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const v = value.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(v)) return true;
  if (['false', '0', 'no'].includes(v)) return false;
  return value; // fails @IsBoolean with a clear message
};

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

  /** Redis for the BullMQ embedding queue (compose: redis://redis:6379). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  REDIS_URL: string = 'redis://127.0.0.1:6379';

  /** Vector size of the embedding model (Qwen3-Embedding truncated to 1024); must match the DB column. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  EMBEDDING_DIM: number = 1024;

  /** Timeout of one /embed call to the AI worker, in ms. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  EMBED_TIMEOUT_MS: number = 60000;

  /** Master switch of the queue (producer + consumer). Default: on, except NODE_ENV=test. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  QUEUE_ENABLED?: boolean;

  /** Run the embedding consumer in this process. Default: on, except NODE_ENV=test. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  QUEUE_WORKER_ENABLED?: boolean;

  /** Parallel embedding jobs per process. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(16)
  EMBED_CONCURRENCY: number = 1;

  /** How often the API looks for documents with missing embeddings, in ms. 0 disables it. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  EMBED_RECONCILE_INTERVAL_MS: number = 600000;

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
