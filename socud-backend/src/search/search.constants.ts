/**
 * Text search configuration of the generated tsvector columns (migration
 * 20261110160000_search_fts_trgm). Queries MUST use the same configuration or stems will not
 * match. 'russian' stems Cyrillic words with russian_stem and ASCII words with english_stem.
 */
export const FTS_CONFIG = 'russian';

/** Reciprocal rank fusion constant (Cormack et al.); 60 is the value from the original paper. */
export const RRF_K = 60;

/** Candidates taken from every retriever before fusion. */
export const RETRIEVER_LIMIT = 20;

/** Results returned to the client. */
export const RESULT_LIMIT = 10;

/** Chunks fetched from the HNSW index before they are reduced to the best chunk per document. */
export const SEMANTIC_CHUNK_CANDIDATES = 60;

/** Longest accepted query (characters); longer input is cut, not rejected. */
export const MAX_QUERY_LENGTH = 256;

/** Titles shorter than this are not matched by the trigram retriever (no usable trigrams). */
export const MIN_TITLE_QUERY_LENGTH = 2;

/** Default of SEARCH_MIN_SIMILARITY (cosine similarity floor for semantic hits). */
export const DEFAULT_MIN_SIMILARITY = 0.2;

/**
 * How long the whole semantic retriever (query embedding + SQL) may take before the search
 * answers from keyword + title alone. The embedding itself can legitimately wait behind a document
 * batch in the single-threaded AI worker (EMBED_QUERY_TIMEOUT_MS, 10 s), keyword results must not.
 */
export const SEMANTIC_BUDGET_MS = 3000;

/** Minimum word_similarity of the title retriever (pg_trgm default is 0.6, too strict for typos). */
export const TITLE_SIMILARITY_THRESHOLD = 0.45;

/**
 * ts_headline markers. Control characters that cannot occur in chunk text, so highlights can be
 * recovered exactly and the result stays plain text (the UI renders it as a text node).
 */
export const HEADLINE_START = '\u0002';
export const HEADLINE_STOP = '\u0003';
