import { ConfigService } from '@nestjs/config';
import { ApiEmbeddingProvider } from './api-embedding.provider';
import {
  configString,
  type EmbeddingProvider,
  type EmbeddingProviderName,
} from './embedding-provider.types';
import { WorkerEmbeddingProvider } from './worker-embedding.provider';

/** EMBEDDING_PROVIDER, default `worker`. Throws on an unknown value. */
export function resolveProviderName(
  config: ConfigService,
): EmbeddingProviderName {
  const raw = configString(config.get('EMBEDDING_PROVIDER'))?.toLowerCase();
  if (raw === undefined || raw === 'worker') return 'worker';
  if (raw === 'api') return 'api';
  throw new Error(`EMBEDDING_PROVIDER must be "worker" or "api", got "${raw}"`);
}

/** Builds the provider selected by EMBEDDING_PROVIDER. */
export function createEmbeddingProvider(
  config: ConfigService,
): EmbeddingProvider {
  return resolveProviderName(config) === 'api'
    ? new ApiEmbeddingProvider(config)
    : new WorkerEmbeddingProvider(config);
}
