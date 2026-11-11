import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** The AI worker accepts at most this many texts per /embed call (MAX_BATCH_SIZE). */
export const EMBED_BATCH_SIZE = 32;

/**
 * Default texts per /embed call. The MLX worker is compute-bound (~0.3–0.5 passages/s on an M1,
 * no gain from larger batches), so small batches keep each call well under the timeout and let a
 * query embedding slip in between document batches. With 1, a search waits at most one chunk (~2.7 s).
 */
export const DEFAULT_EMBED_BATCH_SIZE = 1;

/** Error from the embedding worker. `retryable` tells the queue whether another attempt can help. */
export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/** Client of the AI worker's `POST /embed` (see PHASE2 contract). */
@Injectable()
export class EmbeddingClient {
  constructor(private readonly config: ConfigService) {}

  get dim(): number {
    return Number(this.config.get<number>('EMBEDDING_DIM') ?? 1024);
  }

  // --- MODEL-GUARD STUB: minimal worker-only version of the Phase-3 contract getters. ---
  // On merge, resolve this conflict in favour of the p3/provider branch (it owns the real
  // `modelId`/`provider`); everything else in model-guard only reads `client.modelId`.
  /** Stable id of the vector space the active provider produces (written to DocumentChunk.embeddingModel). */
  get modelId(): string {
    return (
      this.config.get<string>('EMBEDDING_MODEL_ID') ||
      `qwen3-embedding-4b@${this.dim}`
    );
  }

  get provider(): 'worker' | 'api' {
    return 'worker';
  }
  // --- END MODEL-GUARD STUB ---

  private get url(): string {
    const base = this.config.getOrThrow<string>('AI_WORKER_URL');
    return `${base.replace(/\/+$/, '')}/embed`;
  }

  /** Texts per /embed call: EMBED_BATCH_SIZE, clamped to the worker's limit. */
  get batchSize(): number {
    const configured = Number(
      this.config.get<number>('EMBED_BATCH_SIZE') ?? DEFAULT_EMBED_BATCH_SIZE,
    );
    if (!Number.isFinite(configured) || configured < 1) {
      return DEFAULT_EMBED_BATCH_SIZE;
    }
    return Math.min(Math.floor(configured), EMBED_BATCH_SIZE);
  }

  private timeoutMs(isQuery: boolean): number {
    return isQuery
      ? Number(this.config.get<number>('EMBED_QUERY_TIMEOUT_MS') ?? 10_000)
      : Number(this.config.get<number>('EMBED_TIMEOUT_MS') ?? 180_000);
  }

  private get headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = this.config.get<string>('AI_WORKER_TOKEN');
    if (token) headers['X-Worker-Token'] = token;
    return headers;
  }

  /**
   * Embeds `texts`, splitting them into worker-sized batches. Returns one vector per text, in
   * order. Throws EmbeddingError: retryable for network errors, timeouts, 408/429/5xx; not
   * retryable for other 4xx and for responses with the wrong shape or dimension.
   */
  async embed(texts: string[], isQuery = false): Promise<number[][]> {
    const vectors: number[][] = [];
    const size = this.batchSize;
    for (let i = 0; i < texts.length; i += size) {
      vectors.push(
        ...(await this.embedBatch(texts.slice(i, i + size), isQuery)),
      );
    }
    return vectors;
  }

  async embedBatch(texts: string[], isQuery: boolean): Promise<number[][]> {
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ texts, is_query: isQuery }),
        signal: AbortSignal.timeout(this.timeoutMs(isQuery)),
      });
    } catch (err) {
      throw new EmbeddingError(
        `AI worker unreachable: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }

    if (!res.ok) {
      const retryable =
        res.status >= 500 || res.status === 408 || res.status === 429;
      throw new EmbeddingError(
        `AI worker responded ${res.status}`,
        retryable,
        res.status,
      );
    }

    let body: { embeddings?: unknown; dim?: unknown };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new EmbeddingError('AI worker returned invalid JSON', true);
    }

    const embeddings = body.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      throw new EmbeddingError(
        `AI worker returned ${Array.isArray(embeddings) ? embeddings.length : 'no'} embeddings for ${texts.length} texts`,
        false,
      );
    }
    const dim = this.dim;
    for (const vector of embeddings) {
      if (
        !Array.isArray(vector) ||
        vector.length !== dim ||
        !vector.every((x) => typeof x === 'number' && Number.isFinite(x))
      ) {
        throw new EmbeddingError(
          `AI worker returned a vector of dimension ${Array.isArray(vector) ? vector.length : 'n/a'}, expected ${dim}`,
          false,
        );
      }
    }
    return embeddings as number[][];
  }
}
