import { RRF_K } from './search.constants';
import type { SearchSource } from './search.types';

export interface RankedList {
  source: SearchSource;
  /** Document ids, best first. A repeated id keeps its best (first) position. */
  ids: string[];
}

export interface FusedHit {
  id: string;
  score: number;
  /** Retrievers that returned the document, in list order. */
  sources: SearchSource[];
  /** 1-based rank per retriever. */
  ranks: Partial<Record<SearchSource, number>>;
}

const EPSILON = 1e-12;

/**
 * Reciprocal rank fusion: score(d) = sum over lists of 1 / (k + rank(d)).
 * Empty lists (a retriever that found nothing or failed) simply contribute nothing.
 * Ties are broken deterministically: more retrievers, then the better single rank, then the
 * earlier list in `lists`, then the id.
 */
export function reciprocalRankFusion(
  lists: RankedList[],
  { k = RRF_K, limit }: { k?: number; limit?: number } = {},
): FusedHit[] {
  const fused = new Map<
    string,
    FusedHit & { bestRank: number; bestList: number }
  >();

  lists.forEach((list, listIndex) => {
    const seen = new Set<string>();
    let rank = 0;
    for (const id of list.ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      rank += 1;

      let hit = fused.get(id);
      if (!hit) {
        hit = {
          id,
          score: 0,
          sources: [],
          ranks: {},
          bestRank: rank,
          bestList: listIndex,
        };
        fused.set(id, hit);
      }
      hit.score += 1 / (k + rank);
      hit.sources.push(list.source);
      hit.ranks[list.source] = rank;
      if (rank < hit.bestRank) {
        hit.bestRank = rank;
        hit.bestList = listIndex;
      }
    }
  });

  const sorted = [...fused.values()].sort((a, b) => {
    if (Math.abs(a.score - b.score) > EPSILON) return b.score - a.score;
    if (a.sources.length !== b.sources.length) {
      return b.sources.length - a.sources.length;
    }
    if (a.bestRank !== b.bestRank) return a.bestRank - b.bestRank;
    if (a.bestList !== b.bestList) return a.bestList - b.bestList;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const out = sorted.map(({ id, score, sources, ranks }) => ({
    id,
    score,
    sources,
    ranks,
  }));
  return limit === undefined ? out : out.slice(0, limit);
}
