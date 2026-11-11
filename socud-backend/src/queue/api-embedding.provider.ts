import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_EMBEDDING_API_URL } from '../config/embedding-api-url';
import { parseProviderRouting } from '../config/embedding-api-routing';
import { EmbeddingConfigError, EmbeddingError } from './embedding.error';
import { mrlTruncate, prepareText } from './embedding-text';
import {
  configNumber,
  configString,
  resolveModelId,
  type EmbeddingProvider,
} from './embedding-provider.types';

/** Task text of the Qwen3-Embedding query instruction; identical to the worker's default QUERY_INSTRUCTION. */
export const DEFAULT_QUERY_INSTRUCTION =
  'Given a search query, retrieve relevant passages from a knowledge base that answer the query';

/** Max inputs per HTTP request unless EMBEDDING_API_BATCH_SIZE says otherwise. */
export const DEFAULT_API_BATCH_SIZE = 32;
/** Texts per request for documents when EMBED_BATCH_SIZE is not set: APIs are fast, 16 amortises latency. */
export const DEFAULT_API_EMBED_BATCH_SIZE = 16;
/** Retry-After values above this are not waited for in-process; the queue's own backoff takes over. */
export const MAX_RETRY_AFTER_WAIT_MS = 30_000;
/** In-process waits for Retry-After per request before the error is handed to the queue. */
export const MAX_RETRY_AFTER_RETRIES = 2;
/** After a Retry-After wait at least this much of the timeout must remain, or the error is thrown instead. */
const MIN_REQUEST_BUDGET_MS = 1_000;
const PROBE_TIMEOUT_MS = 5_000;
const MAX_DETAIL_CHARS = 200;
/** APIs reject empty inputs; a text that is empty after cleaning gets this placeholder instead. */
const EMPTY_TEXT_PLACEHOLDER = '.';

/** Test seams: the clock-free sleep used for Retry-After. */
export interface ApiProviderDeps {
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Seconds (possibly fractional) or an HTTP date -> milliseconds; undefined when absent/invalid. */
export function parseRetryAfter(
  header: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (!header) return undefined;
  const value = header.trim();
  if (value === '') return undefined;
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 1000);
  if (!/[a-z]/i.test(value)) return undefined; // HTTP dates name a month; "-5" is not a date
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * Vectorizes through a hosted OpenAI-compatible `POST {EMBEDDING_API_URL}/embeddings` (OpenRouter,
 * OpenAI, Together, a local vLLM/Ollama ...). Does the text preparation itself (the worker's
 * cleaning + Qwen3 query instruction, see embedding-text.ts) so no Python worker is needed.
 *
 * Neither the API key nor any text is ever logged or put into an error message.
 */
export class ApiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'api' as const;
  private readonly logger = new Logger('ApiEmbeddingProvider');
  private readonly sleep: (ms: number) => Promise<void>;
  private warnedTruncation = false;

  constructor(
    private readonly config: ConfigService,
    deps: ApiProviderDeps = {},
  ) {
    this.sleep = deps.sleep ?? defaultSleep;
    // Fail at construction (startup), not on the first search.
    void this.apiKey;
    void this.model;
    void this.routing;
  }

  get dim(): number {
    return Number(this.config.get<number>('EMBEDDING_DIM') ?? 1024);
  }

  private get apiKey(): string {
    const key = configString(this.config.get('EMBEDDING_API_KEY'));
    if (!key) {
      throw new EmbeddingConfigError(
        'EMBEDDING_PROVIDER=api requires EMBEDDING_API_KEY',
      );
    }
    return key;
  }

  private get model(): string {
    const model = configString(this.config.get('EMBEDDING_API_MODEL'));
    if (!model) {
      throw new EmbeddingConfigError(
        'EMBEDDING_PROVIDER=api requires EMBEDDING_API_MODEL (e.g. qwen/qwen3-embedding-4b)',
      );
    }
    return model;
  }

  private get baseUrl(): string {
    return (
      configString(this.config.get('EMBEDDING_API_URL')) ??
      DEFAULT_EMBEDDING_API_URL
    ).replace(/\/+$/, '');
  }

  /**
   * EMBEDDING_API_PROVIDER_ROUTING parsed: sent verbatim as the request's `provider` field.
   * Undefined when unset. A value that is not a JSON object is a configuration error (startup
   * validation reports it first; this guards providers built without it).
   */
  private get routing(): Record<string, unknown> | undefined {
    const raw = configString(this.config.get('EMBEDDING_API_PROVIDER_ROUTING'));
    if (raw === undefined) return undefined;
    const parsed = parseProviderRouting(raw);
    if (!parsed.ok) {
      throw new EmbeddingConfigError(
        `EMBEDDING_API_PROVIDER_ROUTING ${parsed.error}`,
      );
    }
    return parsed.routing;
  }

  /** Scheme + host only: safe to log (no path, no credentials). */
  get endpoint(): string {
    return this.origin;
  }

  /** Scheme + host only: safe to log (no path, no credentials). */
  private get origin(): string {
    try {
      return new URL(this.baseUrl).origin;
    } catch {
      return 'the embedding API';
    }
  }

  private get requestedDimensions(): number | undefined {
    return configNumber(this.config.get('EMBEDDING_API_DIMENSIONS'));
  }

  get modelId(): string {
    return resolveModelId(
      this.config.get('EMBEDDING_MODEL_ID'),
      this.model,
      this.dim,
    );
  }

  /**
   * Qwen3-style task text for queries: EMBEDDING_API_QUERY_INSTRUCTION, or the worker's default
   * when the model is a Qwen3-Embedding; `off`/`none` disables it; other models get none.
   */
  private get queryTask(): string | undefined {
    const configured = configString(
      this.config.get('EMBEDDING_API_QUERY_INSTRUCTION'),
    );
    if (configured) {
      return /^(off|none)$/i.test(configured) ? undefined : configured;
    }
    return this.model.toLowerCase().includes('qwen3-embedding')
      ? DEFAULT_QUERY_INSTRUCTION
      : undefined;
  }

  /** Max inputs per HTTP request (EMBEDDING_API_BATCH_SIZE). */
  get maxInputs(): number {
    const n = configNumber(this.config.get('EMBEDDING_API_BATCH_SIZE'));
    return n !== undefined && n >= 1 ? Math.floor(n) : DEFAULT_API_BATCH_SIZE;
  }

  /** Texts per request for documents: EMBED_BATCH_SIZE (default 16), never above EMBEDDING_API_BATCH_SIZE. */
  get batchSize(): number {
    const n = configNumber(this.config.get('EMBED_BATCH_SIZE'));
    const wanted =
      n !== undefined && n >= 1 ? Math.floor(n) : DEFAULT_API_EMBED_BATCH_SIZE;
    return Math.min(wanted, this.maxInputs);
  }

  private timeoutMs(isQuery: boolean): number {
    return isQuery
      ? Number(this.config.get<number>('EMBED_QUERY_TIMEOUT_MS') ?? 10_000)
      : Number(this.config.get<number>('EMBED_TIMEOUT_MS') ?? 180_000);
  }

  private get headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
    const referer = configString(this.config.get('EMBEDDING_API_REFERER'));
    const title = configString(this.config.get('EMBEDDING_API_TITLE'));
    if (referer) headers['HTTP-Referer'] = referer;
    if (title) headers['X-Title'] = title;
    return headers;
  }

  /** Warns once if the API is unreachable or the key is wrong; throws only for configuration errors. */
  async probe(): Promise<void> {
    try {
      const [vector] = await this.request(['warm-up'], false, PROBE_TIMEOUT_MS);
      this.logger.log(
        `Embedding API ${this.origin} ready (model ${this.model}, ${vector.length} dimensions, model id ${this.modelId})`,
      );
    } catch (err) {
      if (err instanceof EmbeddingConfigError) throw err;
      this.logger.warn(
        `Embedding API ${this.origin} not usable yet: ${err instanceof Error ? err.message : String(err)}. ` +
          'Publishing keeps working; embedding is retried and search falls back to keyword results meanwhile.',
      );
    }
  }

  async embedBatch(texts: string[], isQuery: boolean): Promise<number[][]> {
    const timeout = this.timeoutMs(isQuery);
    const vectors: number[][] = [];
    // A caller may pass more than the API accepts per request: split silently.
    for (let i = 0; i < texts.length; i += this.maxInputs) {
      vectors.push(
        ...(await this.request(
          texts.slice(i, i + this.maxInputs),
          isQuery,
          timeout,
        )),
      );
    }
    return vectors;
  }

  private prepare(text: string, isQuery: boolean): string {
    const prepared = prepareText(text, isQuery, this.queryTask);
    return prepared === '' ? EMPTY_TEXT_PLACEHOLDER : prepared;
  }

  private async request(
    texts: string[],
    isQuery: boolean,
    timeoutMs: number,
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    const body: Record<string, unknown> = {
      model: this.model,
      input: texts.map((t) => this.prepare(t, isQuery)),
      encoding_format: 'float',
    };
    const dimensions = this.requestedDimensions;
    if (dimensions !== undefined) body.dimensions = dimensions;
    const routing = this.routing;
    if (routing !== undefined) body.provider = routing;
    const payload = JSON.stringify(body);
    const url = `${this.baseUrl}/embeddings`;
    const headers = this.headers;
    const deadline = Date.now() + timeoutMs;

    for (let attempt = 0; ; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw this.timeoutError(timeoutMs);

      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers,
          body: payload,
          signal: AbortSignal.timeout(remaining),
        });
      } catch (err) {
        throw this.networkError(err, timeoutMs);
      }

      if (res.ok) {
        let parsed: unknown;
        try {
          parsed = await res.json();
        } catch (err) {
          if (isTimeout(err)) throw this.timeoutError(timeoutMs);
          throw new EmbeddingError(
            `Embedding API ${this.origin} returned a response that is not valid JSON`,
            true,
          );
        }
        return this.parseResponse(parsed, texts.length);
      }

      const detail = await this.readErrorDetail(res);
      const retryAfter = parseRetryAfter(res.headers?.get('retry-after'));
      if (
        isRetryableStatus(res.status) &&
        retryAfter !== undefined &&
        attempt < MAX_RETRY_AFTER_RETRIES &&
        retryAfter <= MAX_RETRY_AFTER_WAIT_MS &&
        retryAfter + MIN_REQUEST_BUDGET_MS <= deadline - Date.now()
      ) {
        await this.sleep(retryAfter);
        continue;
      }
      throw this.httpError(res.status, detail, retryAfter);
    }
  }

  private parseResponse(parsed: unknown, expected: number): number[][] {
    if (typeof parsed !== 'object' || parsed === null) {
      throw this.shapeError('the response body is not a JSON object');
    }
    const body = parsed as { data?: unknown; error?: unknown };
    // OpenRouter reports some upstream failures as HTTP 200 with an `error` object.
    if (body.error !== undefined && body.error !== null) {
      throw this.bodyError(body.error);
    }
    const data = body.data;
    if (!Array.isArray(data)) {
      throw this.shapeError('the response has no "data" array');
    }
    if (data.length !== expected) {
      throw this.shapeError(
        `${data.length} embeddings were returned for ${expected} texts`,
      );
    }

    const vectors: (number[] | undefined)[] = new Array<number[] | undefined>(
      expected,
    ).fill(undefined);
    for (const [position, item] of data.entries()) {
      const entry = item as { embedding?: unknown; index?: unknown } | null;
      const vector = entry?.embedding;
      if (
        !Array.isArray(vector) ||
        vector.length === 0 ||
        !vector.every((x) => typeof x === 'number' && Number.isFinite(x))
      ) {
        throw this.shapeError(
          'an embedding is missing, empty, not an array of numbers, or contains NaN/Infinity (is the model an embedding model?)',
        );
      }
      const index = entry?.index === undefined ? position : entry.index;
      if (
        typeof index !== 'number' ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= expected ||
        vectors[index] !== undefined
      ) {
        throw this.shapeError(
          'the "index" fields are not a permutation of the inputs',
        );
      }
      vectors[index] = vector as number[];
    }
    return (vectors as number[][]).map((v) => this.fit(v));
  }

  /** Brings a returned vector to EMBEDDING_DIM: unchanged if equal, MRL-truncated if longer, error if shorter. */
  private fit(vector: number[]): number[] {
    const dim = this.dim;
    if (vector.length === dim) return vector;
    if (vector.length < dim) {
      throw new EmbeddingConfigError(
        `Embedding API returned ${vector.length}-dimensional vectors but EMBEDDING_DIM is ${dim}. ` +
          'Pick a model with at least that many dimensions, or lower EMBEDDING_DIM (the database column vector(N) must match, which needs a migration and a full re-embed).',
      );
    }
    if (!this.warnedTruncation) {
      this.warnedTruncation = true;
      this.logger.warn(
        `Embedding API returns ${vector.length}-dimensional vectors; truncating to EMBEDDING_DIM=${dim} and re-normalising. ` +
          'This is only valid for Matryoshka (MRL) models such as Qwen3-Embedding or OpenAI text-embedding-3; ' +
          'for other models set EMBEDDING_API_DIMENSIONS (if supported) or choose a model that natively outputs that size.',
      );
    }
    const head = vector.slice(0, dim);
    if (head.every((x) => x === 0)) {
      throw this.shapeError(
        'a vector is all zeros in its first EMBEDDING_DIM components, so it cannot be truncated',
      );
    }
    return mrlTruncate(vector, dim);
  }

  private shapeError(what: string): EmbeddingError {
    return new EmbeddingError(
      `Embedding API ${this.origin} returned an unexpected response: ${what}. Check EMBEDDING_API_URL and EMBEDDING_API_MODEL.`,
      false,
    );
  }

  private timeoutError(timeoutMs: number): EmbeddingError {
    return new EmbeddingError(
      `Embedding API ${this.origin} did not answer within ${timeoutMs} ms`,
      true,
    );
  }

  private networkError(err: unknown, timeoutMs: number): EmbeddingError {
    if (isTimeout(err)) return this.timeoutError(timeoutMs);
    const cause = (err as { cause?: { code?: unknown } } | undefined)?.cause;
    const code = typeof cause?.code === 'string' ? ` (${cause.code})` : '';
    return new EmbeddingError(
      `Embedding API ${this.origin} unreachable: ${this.redact(err instanceof Error ? err.message : String(err))}${code}`,
      true,
    );
  }

  /** OpenRouter-style `{error: {message, code}}` inside a 200 response. */
  private bodyError(error: unknown): EmbeddingError {
    const e = error as { message?: unknown; code?: unknown };
    const code = typeof e.code === 'number' ? e.code : Number(e.code);
    const message = typeof e.message === 'string' ? e.message : undefined;
    if (Number.isInteger(code) && code >= 400) {
      return this.httpError(code, message);
    }
    return new EmbeddingError(
      `Embedding API ${this.origin} reported an error${message ? `: ${this.redact(message)}` : ''}`,
      true,
    );
  }

  private async readErrorDetail(res: Response): Promise<string | undefined> {
    try {
      const text = (await res.text()).trim();
      if (text === '') return undefined;
      try {
        const parsed = JSON.parse(text) as {
          error?: { message?: unknown } | string;
          message?: unknown;
        };
        const message =
          typeof parsed.error === 'string'
            ? parsed.error
            : (parsed.error?.message ?? parsed.message);
        if (typeof message === 'string') return message;
      } catch {
        /* not JSON: fall through to the raw text */
      }
      return text;
    } catch {
      return undefined;
    }
  }

  private httpError(
    status: number,
    detail: string | undefined,
    retryAfterMs?: number,
  ): EmbeddingError {
    const where = `Embedding API ${this.origin}`;
    let message: string;
    switch (status) {
      case 400:
        message = `${where} rejected the request (HTTP 400). Check that EMBEDDING_API_MODEL is an embedding model, that EMBEDDING_API_DIMENSIONS (if set) is supported, and that the text is not over the model's token limit.`;
        break;
      case 401:
        message = `${where} rejected the API key (HTTP 401). Check EMBEDDING_API_KEY (it may be wrong, revoked or expired).`;
        break;
      case 402:
        message = `${where} says the account has insufficient credits (HTTP 402). Top up the balance (OpenRouter: openrouter.ai/credits); embedding resumes automatically afterwards.`;
        break;
      case 403:
        message = `${where} refused access (HTTP 403). The key may lack permission for this model, or the provider blocks this region or content.`;
        break;
      case 404:
        message = `${where} returned HTTP 404. Check EMBEDDING_API_URL (it should end in /v1 and "/embeddings" is appended) and EMBEDDING_API_MODEL (the model id must exist and support embeddings).`;
        break;
      case 429:
        message = `${where} rate-limited the request (HTTP 429)${retryAfterMs !== undefined ? `; retry after ${Math.ceil(retryAfterMs / 1000)} s` : ''}. Lower EMBED_CONCURRENCY or EMBED_BATCH_SIZE if this persists.`;
        break;
      default:
        message = `${where} responded HTTP ${status}`;
    }
    if (detail) {
      const shown = this.redact(detail.replace(/\s+/g, ' '));
      message += ` Provider said: ${shown.length > MAX_DETAIL_CHARS ? `${shown.slice(0, MAX_DETAIL_CHARS)}…` : shown}`;
    }
    return new EmbeddingError(
      message,
      isRetryableStatus(status),
      status,
      retryAfterMs,
    );
  }

  /** Never let the API key reach a log line, even if a provider echoes it back. */
  private redact(text: string): string {
    const key = configString(this.config.get('EMBEDDING_API_KEY'));
    return key ? text.split(key).join('***') : text;
  }
}

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: unknown } | undefined)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}
