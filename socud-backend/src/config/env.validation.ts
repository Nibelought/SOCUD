import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
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
import {
  DEFAULT_EMBEDDING_API_URL,
  assessEmbeddingApiUrl,
} from './embedding-api-url';
import { parseProviderRouting } from './embedding-api-routing';
import { applyEmbeddingProfile } from './embedding-profile';

export const NODE_ENVIRONMENTS = ['development', 'production', 'test'] as const;
export const EMBEDDING_PROVIDERS = ['worker', 'api'] as const;

/** The AI worker accepts at most this many texts per /embed call. */
const WORKER_MAX_BATCH_SIZE = 32;

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
  EMBED_TIMEOUT_MS: number = 180000;

  /** Timeout of a search-query /embed call, in ms. Short: search falls back to keyword results. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(500)
  EMBED_QUERY_TIMEOUT_MS: number = 10000;

  /**
   * Texts per embedding request when embedding documents. Unset: 1 for the worker (MLX is compute
   * bound, see embedding.client), 16 for provider=api. The worker accepts at most 32; for
   * provider=api it is capped by EMBEDDING_API_BATCH_SIZE.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2048)
  EMBED_BATCH_SIZE?: number;

  /**
   * Active embedding profile (lower-case, normalised). Variables named `<NAME>__<VAR>` of this
   * profile override the plain ones; see `applyEmbeddingProfile`. Unset: no profile.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  EMBEDDING_PROFILE?: string;

  /** Where embeddings come from: the SOCUD AI worker (default) or a hosted OpenAI-compatible API. */
  @IsOptional()
  @IsIn(EMBEDDING_PROVIDERS)
  EMBEDDING_PROVIDER: (typeof EMBEDDING_PROVIDERS)[number] = 'worker';

  /** provider=api: base URL; `/embeddings` is appended. https required unless the host is local/private. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  EMBEDDING_API_URL: string = DEFAULT_EMBEDDING_API_URL;

  /** provider=api: bearer key. Required then. Never logged. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  EMBEDDING_API_KEY?: string;

  /** provider=api: model id sent in the request, e.g. qwen/qwen3-embedding-4b. Required then. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  EMBEDDING_API_MODEL?: string;

  /** provider=api: send `dimensions` in the request (only for models that support it); >= EMBEDDING_DIM. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  EMBEDDING_API_DIMENSIONS?: number;

  /** provider=api: max inputs per HTTP request (the API's limit). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2048)
  EMBEDDING_API_BATCH_SIZE: number = 32;

  /**
   * provider=api: task text of the Qwen3 query prefix ("Instruct: {task}\nQuery:{query}"). Unset: the
   * worker's default for qwen3-embedding models, none for others. `off` disables it.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  EMBEDDING_API_QUERY_INSTRUCTION?: string;

  /**
   * provider=api: optional JSON object sent verbatim as the request's `provider` field (OpenRouter
   * provider routing), e.g. {"sort":"latency"} or {"ignore":["DeepInfra"]}. Unset: field omitted.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  EMBEDDING_API_PROVIDER_ROUTING?: string;

  /** Declares the vector space for DocumentChunk.embeddingModel; default derived from provider and model. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  EMBEDDING_MODEL_ID?: string;

  /** provider=api: optional OpenRouter attribution headers (HTTP-Referer, X-Title). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  EMBEDDING_API_REFERER?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  EMBEDDING_API_TITLE?: string;

  /**
   * Search: semantic hits with a cosine similarity below this are dropped (the nearest chunks are
   * otherwise returned even when nothing is relevant). 0.35 was calibrated with Qwen3-Embedding-4B
   * (1024-dim MRL, query instruction): best chunks of relevant documents scored 0.44-0.78 (median
   * 0.62), best chunks for queries with no relevant document 0.13-0.39 (median 0.28).
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-1)
  @Max(1)
  SEARCH_MIN_SIMILARITY: number = 0.35;

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

  /**
   * Serves Swagger UI at /api/docs and the OpenAPI JSON at /api/docs-json.
   * Unset: enabled unless NODE_ENV=production (see `isSwaggerEnabled`).
   */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED?: boolean;

  /**
   * Optional `Domain` attribute of the `socud_session` hint cookie, needed only when the web app and
   * the API live on different subdomains (e.g. `.example.com`). Unset: host-only cookie.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  SESSION_COOKIE_DOMAIN?: string;

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

/** Rules that involve several variables (EMBEDDING_PROVIDER decides which ones apply). */
function crossFieldProblems(env: EnvironmentVariables): string[] {
  const problems: string[] = [];
  if (env.EMBEDDING_API_PROVIDER_ROUTING !== undefined) {
    const routing = parseProviderRouting(env.EMBEDDING_API_PROVIDER_ROUTING);
    if (!routing.ok) {
      problems.push(`  - EMBEDDING_API_PROVIDER_ROUTING: ${routing.error}`);
    }
  }
  if (env.EMBEDDING_PROVIDER === 'worker') {
    if (
      env.EMBED_BATCH_SIZE !== undefined &&
      env.EMBED_BATCH_SIZE > WORKER_MAX_BATCH_SIZE
    ) {
      problems.push(
        `  - EMBED_BATCH_SIZE: must not be greater than ${WORKER_MAX_BATCH_SIZE} for EMBEDDING_PROVIDER=worker`,
      );
    }
    return problems;
  }

  if (!env.EMBEDDING_API_KEY) {
    problems.push(
      '  - EMBEDDING_API_KEY: required when EMBEDDING_PROVIDER=api (an OpenRouter key: https://openrouter.ai/keys)',
    );
  }
  if (!env.EMBEDDING_API_MODEL) {
    problems.push(
      '  - EMBEDDING_API_MODEL: required when EMBEDDING_PROVIDER=api (e.g. qwen/qwen3-embedding-4b)',
    );
  }
  const url = assessEmbeddingApiUrl(env.EMBEDDING_API_URL);
  if (!url.ok) {
    problems.push(`  - EMBEDDING_API_URL: ${url.error}`);
  } else if (url.warning) {
    console.warn(`[config] WARN: ${url.warning}`);
  }
  if (
    env.EMBEDDING_API_DIMENSIONS !== undefined &&
    env.EMBEDDING_API_DIMENSIONS < env.EMBEDDING_DIM
  ) {
    problems.push(
      `  - EMBEDDING_API_DIMENSIONS: ${env.EMBEDDING_API_DIMENSIONS} is smaller than EMBEDDING_DIM=${env.EMBEDDING_DIM}; the API would return vectors that are too short`,
    );
  }
  if (
    env.EMBED_BATCH_SIZE !== undefined &&
    env.EMBED_BATCH_SIZE > env.EMBEDDING_API_BATCH_SIZE
  ) {
    console.warn(
      `[config] WARN: EMBED_BATCH_SIZE=${env.EMBED_BATCH_SIZE} exceeds EMBEDDING_API_BATCH_SIZE=${env.EMBEDDING_API_BATCH_SIZE}; ${env.EMBEDDING_API_BATCH_SIZE} texts per request will be used`,
    );
  }
  return problems;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  // The active embedding profile overrides plain variables first (also empty ones, which compose
  // passes for unset variables); a bad profile is reported on its own, before anything else.
  let resolved: Record<string, unknown>;
  try {
    resolved = applyEmbeddingProfile(config).env;
  } catch (err) {
    throw new Error(
      `Invalid environment configuration:\n  - ${err instanceof Error ? err.message : String(err)}\n` +
        'See socud-backend/.env.example for the expected variables.',
    );
  }

  // Treat empty strings (e.g. `PORT=` in .env) as "not set" so defaults apply.
  const cleaned = Object.fromEntries(
    Object.entries(resolved).filter(([, value]) => value !== ''),
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

  if (problems.length === 0) problems.push(...crossFieldProblems(validated));

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
