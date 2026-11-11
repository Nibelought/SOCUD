import { ConfigService } from '@nestjs/config';
import { EmbeddingError } from './embedding.error';
import {
  DEFAULT_EMBED_BATCH_SIZE,
  DEFAULT_LOCAL_MODEL,
  EMBED_BATCH_SIZE,
  configNumber,
  resolveModelId,
  type EmbeddingProvider,
} from './embedding-provider.types';

/** Client of the AI worker's `POST /embed` (see PHASE2 contract). The default provider. */
export class WorkerEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'worker' as const;

  constructor(private readonly config: ConfigService) {}

  get dim(): number {
    return Number(this.config.get<number>('EMBEDDING_DIM') ?? 1024);
  }

  get modelId(): string {
    return resolveModelId(
      this.config.get('EMBEDDING_MODEL_ID'),
      DEFAULT_LOCAL_MODEL,
      this.dim,
    );
  }

  /** Scheme + host (+ port) of AI_WORKER_URL: safe to log (no path, no credentials). */
  get endpoint(): string {
    try {
      return new URL(this.config.getOrThrow<string>('AI_WORKER_URL')).origin;
    } catch {
      return 'the AI worker';
    }
  }

  private get url(): string {
    const base = this.config.getOrThrow<string>('AI_WORKER_URL');
    return `${base.replace(/\/+$/, '')}/embed`;
  }

  /** Texts per /embed call: EMBED_BATCH_SIZE, clamped to the worker's limit. */
  get batchSize(): number {
    const configured = configNumber(this.config.get('EMBED_BATCH_SIZE'));
    if (configured === undefined || configured < 1) {
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
