import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** The AI worker accepts at most this many texts per /embed call (MAX_BATCH_SIZE). */
export const EMBED_BATCH_SIZE = 32;

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

  private get url(): string {
    const base = this.config.getOrThrow<string>('AI_WORKER_URL');
    return `${base.replace(/\/+$/, '')}/embed`;
  }

  private get timeoutMs(): number {
    return Number(this.config.get<number>('EMBED_TIMEOUT_MS') ?? 60_000);
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
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      vectors.push(
        ...(await this.embedBatch(
          texts.slice(i, i + EMBED_BATCH_SIZE),
          isQuery,
        )),
      );
    }
    return vectors;
  }

  /**
   * Embeds one search query (`is_query: true`) with its own, short timeout, so an interactive
   * request is not held up by the long timeout meant for document batches.
   */
  async embedQuery(text: string, timeoutMs: number): Promise<number[]> {
    const [vector] = await this.embedBatch([text], true, timeoutMs);
    return vector;
  }

  async embedBatch(
    texts: string[],
    isQuery: boolean,
    timeoutMs: number = this.timeoutMs,
  ): Promise<number[][]> {
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ texts, is_query: isQuery }),
        signal: AbortSignal.timeout(timeoutMs),
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
