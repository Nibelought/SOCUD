export type SearchSource = 'semantic' | 'keyword' | 'title';

export interface SearchHighlight {
  start: number;
  end: number;
}

/**
 * One search result. `snippet` is PLAIN TEXT, never HTML: clients must render it as text.
 * `score` keeps its old meaning (cosine similarity 0..1 of the best chunk, only for semantic
 * matches, else null); the fused ranking value is `rrfScore`.
 */
export interface SearchResult {
  id: string;
  title: string;
  space: string;
  snippet: string;
  type: 'semantic' | 'keyword';
  score: number | null;
  matchedBy: SearchSource[];
  rrfScore: number;
  /** Matched ranges inside `snippet` (keyword matches only). */
  highlights?: SearchHighlight[];
}

export interface SemanticHit {
  id: string;
  /** Cosine similarity of the best chunk. */
  similarity: number;
  text: string;
}

export interface KeywordHit {
  id: string;
  rank: number;
  /** The title matched too. */
  inTitle: boolean;
  /** ts_headline output with HEADLINE_START/STOP markers, or null if only the title matched. */
  headline: string | null;
}

export interface TitleHit {
  id: string;
  similarity: number;
  /** Beginning of the first published chunk, used as a snippet. */
  lead: string | null;
}
