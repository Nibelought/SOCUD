import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingClient } from './embedding.client';

/**
 * Model of every vector stored before `DocumentChunk.embeddingModel` existed (the local
 * Qwen3-Embedding-4B worker, 1024 dims). The migration backfills this value; rows that still have
 * a vector but no model (written by an older build during a rolling deploy) are counted as it too.
 */
export const LEGACY_EMBEDDING_MODEL = 'qwen3-embedding-4b@1024';

/** How long a computed status is reused (one cheap GROUP BY, but the admin UI and the embed path poll it). */
export const STATUS_CACHE_TTL_MS = 30_000;
/** Minimum time between two "embedding with a mismatching index" warnings (never one per chunk/document). */
export const EMBED_WARN_INTERVAL_MS = 10 * 60_000;

export interface StoredEmbeddingModel {
  model: string;
  /** Chunks that have a vector produced by this model. */
  chunks: number;
  /** Distinct documents owning those chunks. */
  documents: number;
}

export interface EmbeddingStatus {
  /** Active EMBEDDING_PROFILE, or null when none is selected. */
  profile: string | null;
  activeModel: string;
  provider: 'worker' | 'api';
  dim: number;
  /** Models present in the index, largest first. Chunks without a vector are not counted. */
  stored: StoredEmbeddingModel[];
  /** True when the index holds vectors of a model other than the active one. */
  mismatch: boolean;
  /** Empty unless `mismatch`. */
  recommendedActions: string[];
}

/** The most useful single command; --inline runs without Redis. */
export const REEMBED_COMMAND =
  'npm run backfill:embeddings -- --reembed-mismatched';

/** Actions for a mismatch (contract: re-embed, switch back, or declare the same vector space). */
export function buildRecommendedActions(
  activeModel: string,
  stored: StoredEmbeddingModel[],
): string[] {
  const other = stored.filter((s) => s.model !== activeModel);
  if (other.length === 0) return [];
  const dominant = other[0].model;
  return [
    `Re-embed the documents with the active model (${activeModel}): run \`${REEMBED_COMMAND}\` (add \`--inline\` to run without Redis). Search keeps working meanwhile, but mixed results are unreliable until it finishes.`,
    `Or switch EMBEDDING_PROVIDER / EMBEDDING_API_MODEL back to the model the index was built with (${other.map((s) => s.model).join(', ')}) and restart the API.`,
    `Or, if the models are actually the same vector space, set EMBEDDING_MODEL_ID=${dominant} to declare it (no re-embedding needed).`,
  ];
}

/** One-line description for logs: names stored model(s), the active one, counts and the actions. */
export function describeMismatch(status: EmbeddingStatus): string {
  const stored = status.stored
    .filter((s) => s.model !== status.activeModel)
    .map((s) => `${s.model} (${s.chunks} chunks in ${s.documents} documents)`)
    .join(', ');
  const same = status.stored.find((s) => s.model === status.activeModel);
  const alongside = same
    ? `; ${same.chunks} chunks in ${same.documents} documents already use the active model`
    : '';
  const actions = status.recommendedActions
    .map((a, i) => `(${i + 1}) ${a}`)
    .join(' ');
  return (
    `Embedding model mismatch: the index holds vectors from ${stored}, but the active model is ` +
    `${status.activeModel}${alongside}. Vectors from different models are not comparable, so ` +
    `semantic search results mixing them are unreliable. Recommended actions: ${actions}`
  );
}

interface StoredRow {
  model: string;
  chunks: number;
  documents: number;
}

/**
 * Compares the embedding model(s) the index was built with against the active one. It only ever
 * WARNS (startup log, rate-limited log while embedding, admin endpoint): search and embedding are
 * never blocked, and every failure here is swallowed by the callers that sit on those paths.
 */
@Injectable()
export class EmbeddingModelGuard implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmbeddingModelGuard.name);
  private cache?: { at: number; status: EmbeddingStatus };
  private lastEmbedWarningAt?: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingClient,
  ) {}

  onApplicationBootstrap(): void {
    // Fire and forget: a slow or unreachable database must not delay startup.
    void this.warnOnStartup();
  }

  /** Logs the startup warning; resolves to the status (or null when it could not be computed). */
  async warnOnStartup(): Promise<EmbeddingStatus | null> {
    try {
      const status = await this.getStatus(true);
      if (status.mismatch) this.logger.warn(describeMismatch(status));
      return status;
    } catch (err) {
      this.logger.debug(
        `Embedding model check skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Call before embedding a document. Logs a WARN (at most once per EMBED_WARN_INTERVAL_MS) when
   * the index holds vectors of other models. Never throws and never delays embedding on failure.
   */
  async warnBeforeEmbedding(documentId: string): Promise<void> {
    try {
      const now = Date.now();
      if (
        this.lastEmbedWarningAt !== undefined &&
        now - this.lastEmbedWarningAt < EMBED_WARN_INTERVAL_MS
      ) {
        return;
      }
      const status = await this.getStatus();
      if (!status.mismatch) return;
      this.lastEmbedWarningAt = now;
      this.logger.warn(
        `Embedding document ${documentId} with ${status.activeModel}. ${describeMismatch(status)}`,
      );
    } catch (err) {
      this.logger.debug(
        `Embedding model check skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Cached for STATUS_CACHE_TTL_MS; `fresh` bypasses the cache. */
  async getStatus(fresh = false): Promise<EmbeddingStatus> {
    const now = Date.now();
    if (!fresh && this.cache && now - this.cache.at < STATUS_CACHE_TTL_MS) {
      return this.cache.status;
    }
    const status = await this.compute();
    this.cache = { at: now, status };
    return status;
  }

  /** Drops the cached status (e.g. after a re-embed run in this process). */
  invalidate(): void {
    this.cache = undefined;
  }

  private async compute(): Promise<EmbeddingStatus> {
    const activeModel = this.embeddings.modelId;
    const rows = await this.prisma.$queryRaw<StoredRow[]>`
      SELECT COALESCE("embeddingModel", ${LEGACY_EMBEDDING_MODEL}) AS "model",
             COUNT(*)::int AS "chunks",
             COUNT(DISTINCT "documentId")::int AS "documents"
      FROM "DocumentChunk"
      WHERE "embedding" IS NOT NULL
      GROUP BY 1
      ORDER BY 2 DESC, 1
    `;
    const stored = rows.map((r) => ({
      model: r.model,
      chunks: Number(r.chunks),
      documents: Number(r.documents),
    }));
    const mismatch = stored.some((s) => s.model !== activeModel);
    return {
      profile: this.embeddings.profile ?? null,
      activeModel,
      provider: this.embeddings.provider,
      dim: this.embeddings.dim,
      stored,
      mismatch,
      recommendedActions: mismatch
        ? buildRecommendedActions(activeModel, stored)
        : [],
    };
  }
}
