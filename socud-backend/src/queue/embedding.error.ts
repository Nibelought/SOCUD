/** Error from an embedding provider. `retryable` tells the queue whether another attempt can help. */
export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    /** Server-requested wait before the next attempt (Retry-After), when it sent one. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/**
 * The provider's output cannot work with this installation's configuration (e.g. vectors shorter
 * than EMBEDDING_DIM). Never retryable; the startup probe lets it abort the boot instead of only
 * warning, because it will fail for every request.
 */
export class EmbeddingConfigError extends EmbeddingError {
  constructor(message: string) {
    super(message, false);
    this.name = 'EmbeddingConfigError';
  }
}
