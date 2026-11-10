export const EMBEDDINGS_QUEUE = 'embeddings';
export const EMBED_DOCUMENT_JOB = 'embed-document';

/** Payload of an `embed-document` job. */
export interface EmbedDocumentJobData {
  documentId: string;
  /** Document.publishedVersion this job was created for; a job for an older version is a no-op. */
  version: number;
  /**
   * Re-chunk the document from its published HTML before embedding (backfill / legacy documents).
   * Publish already wrote the chunks inside its transaction and does not set this.
   */
  rebuildChunks?: boolean;
}

/** Attempts/backoff for embedding jobs: 5 tries, 5 s, 10 s, 20 s, 40 s. */
export const EMBED_JOB_ATTEMPTS = 5;
export const EMBED_JOB_BACKOFF_MS = 5_000;
