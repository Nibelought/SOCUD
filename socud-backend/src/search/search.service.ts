import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionService } from '../permission/permission.service';
import { EmbeddingClient } from '../queue/embedding.client';
import {
  DEFAULT_MIN_SIMILARITY,
  FTS_CONFIG,
  HEADLINE_START,
  HEADLINE_STOP,
  MAX_QUERY_LENGTH,
  MIN_TITLE_QUERY_LENGTH,
  RESULT_LIMIT,
  RETRIEVER_LIMIT,
  SEMANTIC_BUDGET_MS,
  SEMANTIC_CHUNK_CANDIDATES,
  TITLE_SIMILARITY_THRESHOLD,
} from './search.constants';
import { reciprocalRankFusion } from './rrf';
import { parseHeadline, plainSnippet } from './snippet';
import type {
  KeywordHit,
  SearchResult,
  SearchSource,
  SemanticHit,
  TitleHit,
} from './search.types';

/** Escapes `\`, `%` and `_` so user input is matched literally by (I)LIKE. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Rejects after `ms` so a slow retriever cannot hold the others up; late results are discarded. */
function withBudget<T>(promise: Promise<T>, ms: number): Promise<T> {
  promise.catch(() => undefined); // an abandoned retriever must not become an unhandled rejection
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`semantic retriever exceeded ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Hybrid search over the documents the caller may see.
 *
 * Three retrievers run in parallel, each restricted to accessible documents INSIDE the SQL
 * (`PermissionService.accessibleDocumentsSql`) and limited to the top RETRIEVER_LIMIT:
 *  - semantic: query embedding vs. chunk embeddings (pgvector HNSW), best chunk per document;
 *  - keyword: websearch_to_tsquery over chunk text and document titles (GIN tsvector);
 *  - title: pg_trgm word similarity / ILIKE over titles (typos, partial words).
 * Their rankings are merged with reciprocal rank fusion. A failing retriever (e.g. the AI worker
 * is down) is skipped; only if all of them fail does the request fail.
 *
 * What is searchable: titles of every non-archived accessible document (drafts and never
 * published documents included) and the PUBLISHED text (DocumentChunk). Draft text is not
 * indexed. Final results are re-checked against `accessibleDocumentsWhere` when titles and
 * space names are loaded.
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly embeddings: EmbeddingClient,
    private readonly config: ConfigService,
  ) {}

  /** Cosine similarity below which a semantic hit is considered noise. */
  private get minSimilarity(): number {
    return Number(
      this.config.get<number>('SEARCH_MIN_SIMILARITY') ??
        DEFAULT_MIN_SIMILARITY,
    );
  }

  async search(userId: string, rawQuery: string): Promise<SearchResult[]> {
    const query = (rawQuery ?? '').trim().slice(0, MAX_QUERY_LENGTH);
    if (!query) return [];

    const [semantic, keyword, title] = await Promise.allSettled([
      withBudget(this.semanticHits(userId, query), SEMANTIC_BUDGET_MS),
      this.keywordHits(userId, query),
      this.titleHits(userId, query),
    ]);

    const failures = [semantic, keyword, title].filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    if (failures.length === 3) throw failures[0].reason;
    for (const failure of failures) {
      // Never log the query itself: it may contain sensitive text.
      this.logger.warn(
        `A search retriever failed and was skipped: ${
          failure.reason instanceof Error
            ? failure.reason.message
            : String(failure.reason)
        }`,
      );
    }

    const semanticHits = semantic.status === 'fulfilled' ? semantic.value : [];
    const keywordHits = keyword.status === 'fulfilled' ? keyword.value : [];
    const titleHits = title.status === 'fulfilled' ? title.value : [];

    const fused = reciprocalRankFusion(
      [
        { source: 'semantic', ids: semanticHits.map((h) => h.id) },
        { source: 'keyword', ids: keywordHits.map((h) => h.id) },
        { source: 'title', ids: titleHits.map((h) => h.id) },
      ],
      { limit: RESULT_LIMIT },
    );
    if (fused.length === 0) return [];

    const semanticById = new Map(semanticHits.map((h) => [h.id, h]));
    const keywordById = new Map(keywordHits.map((h) => [h.id, h]));
    const titleById = new Map(titleHits.map((h) => [h.id, h]));

    // Second line of defence and the display data: only documents the caller may see.
    const accessible = await this.permissions.accessibleDocumentsWhere(userId);
    const docs = await this.prisma.document.findMany({
      where: { AND: [{ id: { in: fused.map((f) => f.id) } }, accessible] },
      select: { id: true, title: true, space: { select: { name: true } } },
    });
    const docById = new Map(docs.map((d) => [d.id, d]));

    const results: SearchResult[] = [];
    for (const hit of fused) {
      const doc = docById.get(hit.id);
      if (!doc) continue;

      const sem = semanticById.get(hit.id);
      const kw = keywordById.get(hit.id);
      const tit = titleById.get(hit.id);

      const matchedBy: SearchSource[] = [...hit.sources];
      if (kw?.inTitle && !matchedBy.includes('title')) matchedBy.push('title');

      let snippet = '';
      let highlights: SearchResult['highlights'];
      if (kw?.headline) {
        const parsed = parseHeadline(kw.headline);
        snippet = parsed.text;
        highlights = parsed.highlights;
      } else if (sem) {
        snippet = plainSnippet(sem.text);
      } else if (tit?.lead) {
        snippet = plainSnippet(tit.lead);
      }

      results.push({
        id: doc.id,
        title: doc.title,
        space: doc.space.name,
        snippet,
        type: sem ? 'semantic' : 'keyword',
        score: sem ? Math.round(sem.similarity * 100) / 100 : null,
        matchedBy,
        rrfScore: Math.round(hit.score * 10_000) / 10_000,
        ...(highlights && highlights.length > 0 ? { highlights } : {}),
      });
    }
    return results;
  }

  /** Query embedding -> best chunk per accessible document, nearest first. */
  private async semanticHits(
    userId: string,
    query: string,
  ): Promise<SemanticHit[]> {
    const [vector] = await this.embeddings.embed([query], true);
    const literal = `[${vector.join(',')}]`;
    const access = this.permissions.accessibleDocumentsSql(userId, 'd');

    // The inner query keeps the "ORDER BY embedding <=> q LIMIT n" shape so the HNSW index is
    // used; the access filter is applied while scanning (iterative scan makes the index keep
    // going until n visible rows are found instead of returning too few). Reducing to the best
    // chunk per document happens in the outer queries, DISTINCT ON inside would defeat the index.
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true), set_config('hnsw.ef_search', '100', true)`;
      return tx.$queryRaw<{ id: string; similarity: number; text: string }[]>`
        SELECT best."documentId" AS id, 1 - best.dist AS similarity, best."textContent" AS text
        FROM (
          SELECT DISTINCT ON (nn."documentId") nn."documentId", nn."textContent", nn.dist
          FROM (
            SELECT c."documentId", c."textContent", c."embedding" <=> ${literal}::vector AS dist
            FROM "DocumentChunk" c
            JOIN "Document" d ON d."id" = c."documentId"
            WHERE c."embedding" IS NOT NULL AND ${access}
            ORDER BY c."embedding" <=> ${literal}::vector
            LIMIT ${SEMANTIC_CHUNK_CANDIDATES}
          ) nn
          ORDER BY nn."documentId", nn.dist
        ) best
        ORDER BY best.dist, best."documentId"
        LIMIT ${RETRIEVER_LIMIT}
      `;
    });
    const floor = this.minSimilarity;
    return rows
      .map((r) => ({
        id: r.id,
        similarity: Number(r.similarity),
        text: r.text,
      }))
      .filter((h) => h.similarity >= floor); // also drops NaN (zero vectors)
  }

  /** websearch_to_tsquery over published chunks and document titles (title match weighs A). */
  private async keywordHits(
    userId: string,
    query: string,
  ): Promise<KeywordHit[]> {
    const access = this.permissions.accessibleDocumentsSql(userId, 'd');
    const config = Prisma.raw(`'${FTS_CONFIG}'::regconfig`);
    const options = `StartSel=${HEADLINE_START},StopSel=${HEADLINE_STOP},MaxFragments=1,MinWords=12,MaxWords=32,ShortWord=2`;

    const rows = await this.prisma.$queryRaw<
      { id: string; rank: number; inTitle: boolean; headline: string | null }[]
    >`
      WITH q AS (SELECT websearch_to_tsquery(${config}, ${query}) AS tsq),
      chunk_hit AS (
        SELECT DISTINCT ON (c."documentId")
               c."documentId" AS id, c."textContent" AS text,
               ts_rank_cd(c."searchVector", q.tsq, 32) AS rank
        FROM q, "DocumentChunk" c
        JOIN "Document" d ON d."id" = c."documentId"
        WHERE c."searchVector" @@ q.tsq AND ${access}
        ORDER BY c."documentId", rank DESC
      ),
      title_hit AS (
        SELECT d."id", ts_rank_cd(d."searchVector", q.tsq, 32) AS rank
        FROM q, "Document" d
        WHERE d."searchVector" @@ q.tsq AND ${access}
      ),
      merged AS (
        SELECT COALESCE(ch.id, th."id") AS id,
               GREATEST(COALESCE(ch.rank, 0), COALESCE(th.rank, 0)) AS rank,
               (th."id" IS NOT NULL) AS "inTitle",
               ch.text
        FROM chunk_hit ch
        FULL JOIN title_hit th ON th."id" = ch.id
        ORDER BY 2 DESC, 1
        LIMIT ${RETRIEVER_LIMIT}
      )
      SELECT m.id, m.rank, m."inTitle",
             CASE WHEN m.text IS NULL THEN NULL
                  ELSE ts_headline(${config}, m.text, (SELECT tsq FROM q), ${options}) END AS headline
      FROM merged m
      ORDER BY m.rank DESC, m.id
    `;
    return rows.map((r) => ({
      id: r.id,
      rank: Number(r.rank),
      inTitle: r.inTitle,
      headline: r.headline,
    }));
  }

  /** Trigram word similarity / substring match on titles. */
  private async titleHits(userId: string, query: string): Promise<TitleHit[]> {
    if (query.length < MIN_TITLE_QUERY_LENGTH) return [];
    const access = this.permissions.accessibleDocumentsSql(userId, 'd');
    const pattern = `%${escapeLike(query)}%`;

    const rows = await this.prisma.$transaction(async (tx) => {
      // `<%` uses this threshold (the default 0.6 misses typical typos).
      await tx.$executeRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(TITLE_SIMILARITY_THRESHOLD)}, true)`;
      return tx.$queryRaw<
        { id: string; similarity: number; lead: string | null }[]
      >`
        SELECT t.id, t.similarity,
               (SELECT left(c."textContent", 600) FROM "DocumentChunk" c
                 WHERE c."documentId" = t.id ORDER BY c."chunkIndex" LIMIT 1) AS lead
        FROM (
          SELECT d."id", word_similarity(${query}, d."title") AS similarity,
                 (d."title" ILIKE ${pattern}) AS substring_match
          FROM "Document" d
          WHERE (${query} <% d."title" OR d."title" ILIKE ${pattern}) AND ${access}
          ORDER BY (d."title" ILIKE ${pattern}) DESC, word_similarity(${query}, d."title") DESC, d."title", d."id"
          LIMIT ${RETRIEVER_LIMIT}
        ) t
        ORDER BY t.substring_match DESC, t.similarity DESC, t.id
      `;
    });
    return rows.map((r) => ({
      id: r.id,
      similarity: Number(r.similarity),
      lead: r.lead,
    }));
  }
}
