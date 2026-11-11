/** The AI worker accepts at most this many texts per /embed call (MAX_BATCH_SIZE). */
export const EMBED_BATCH_SIZE = 32;

/**
 * Default texts per /embed call. The MLX worker is compute-bound (~0.3–0.5 passages/s on an M1,
 * no gain from larger batches), so small batches keep each call well under the timeout and let a
 * query embedding slip in between document batches. With 1, a search waits at most one chunk (~2.7 s).
 */
export const DEFAULT_EMBED_BATCH_SIZE = 1;

/** Injection token of the active EmbeddingProvider (see QueueModule). */
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

export type EmbeddingProviderName = 'worker' | 'api';

/** Model behind the worker's vector space (all worker backends serve Qwen3-Embedding-4B). */
export const DEFAULT_LOCAL_MODEL = 'qwen3-embedding-4b';

/** One way of turning texts into vectors. EmbeddingClient delegates to exactly one. */
export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  /** Stable id of the vector space produced, e.g. `qwen3-embedding-4b@1024`. */
  readonly modelId: string;
  /** Vector size the database column expects (EMBEDDING_DIM). */
  readonly dim: number;
  /** Origin (scheme + host + port) of the service it talks to; safe to log. */
  readonly endpoint?: string;
  /** Texts per request when embedding documents. */
  readonly batchSize: number;
  /** One request's worth of texts (at most `batchSize` for callers that respect it). */
  embedBatch(texts: string[], isQuery: boolean): Promise<number[][]>;
  /** Optional startup check. Must not throw for "service unreachable"; throws only for configuration errors. */
  probe?(): Promise<void>;
}

/** Config value as a trimmed non-empty string; '' and undefined mean "not set". */
export function configString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Config value as a finite number; '', undefined and garbage mean "not set". */
export function configNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** `EMBEDDING_MODEL_ID` if set, else `<fallbackModel>@<dim>` (lower-cased). */
export function resolveModelId(
  override: unknown,
  fallbackModel: string,
  dim: number,
): string {
  return configString(override) ?? `${fallbackModel}@${dim}`.toLowerCase();
}
