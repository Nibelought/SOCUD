import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createEmbeddingProvider } from './embedding-provider.factory';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
  type EmbeddingProviderName,
} from './embedding-provider.types';

export { EmbeddingConfigError, EmbeddingError } from './embedding.error';
export {
  DEFAULT_EMBED_BATCH_SIZE,
  EMBED_BATCH_SIZE,
} from './embedding-provider.types';

/**
 * Turns texts into vectors through the provider chosen by EMBEDDING_PROVIDER:
 *  - `worker` (default): the SOCUD AI worker's `POST /embed` (see PHASE2 contract);
 *  - `api`: a hosted OpenAI-compatible `/embeddings` API such as OpenRouter.
 * The public API is the same for both; see `WorkerEmbeddingProvider` / `ApiEmbeddingProvider`.
 */
@Injectable()
export class EmbeddingClient implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingClient.name);
  private readonly impl: EmbeddingProvider;
  private readonly activeProfile: string | null;

  constructor(
    config: ConfigService,
    @Optional() @Inject(EMBEDDING_PROVIDER) provider?: EmbeddingProvider,
  ) {
    this.impl = provider ?? createEmbeddingProvider(config);
    const profile = config.get<string>('EMBEDDING_PROFILE');
    this.activeProfile =
      typeof profile === 'string' && profile !== '' ? profile : null;
  }

  /**
   * Logs which embedding method is active, then probes the provider once; an unreachable API only
   * logs a warning. Skipped in tests. Runs in every process that builds this client (API, backfill
   * and seed scripts), so the active profile is always visible in the log.
   */
  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    this.logger.log(this.describe());
    await this.impl.probe?.();
  }

  /** Name of the active embedding profile (EMBEDDING_PROFILE), or null when none is selected. */
  get profile(): string | null {
    return this.activeProfile;
  }

  /** One log line: profile, provider, model id and the service origin. Never contains a secret. */
  describe(): string {
    const endpoint = this.impl.endpoint ? `, ${this.impl.endpoint}` : '';
    return `Embedding profile: ${this.activeProfile ?? 'none'} (provider ${this.provider}, model id ${this.modelId}${endpoint})`;
  }

  get dim(): number {
    return this.impl.dim;
  }

  /** Stable id of the vector space the active provider produces, e.g. `qwen3-embedding-4b@1024`. */
  get modelId(): string {
    return this.impl.modelId;
  }

  get provider(): EmbeddingProviderName {
    return this.impl.name;
  }

  /** Texts per request when embedding documents (provider specific, see EMBED_BATCH_SIZE). */
  get batchSize(): number {
    return this.impl.batchSize;
  }

  /**
   * Embeds `texts`, splitting them into provider-sized batches. Returns one vector per text, in
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

  embedBatch(texts: string[], isQuery: boolean): Promise<number[][]> {
    return this.impl.embedBatch(texts, isQuery);
  }
}
