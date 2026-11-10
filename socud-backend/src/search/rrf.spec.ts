import { reciprocalRankFusion } from './rrf';

describe('reciprocalRankFusion', () => {
  it('scores 1/(k+rank) per list and sums across lists', () => {
    const out = reciprocalRankFusion([
      { source: 'semantic', ids: ['a', 'b'] },
      { source: 'keyword', ids: ['b', 'c'] },
    ]);
    const byId = Object.fromEntries(out.map((h) => [h.id, h]));
    expect(byId.a.score).toBeCloseTo(1 / 61);
    expect(byId.b.score).toBeCloseTo(1 / 62 + 1 / 61);
    expect(byId.c.score).toBeCloseTo(1 / 62);
    expect(out.map((h) => h.id)).toEqual(['b', 'a', 'c']);
    expect(byId.b.sources).toEqual(['semantic', 'keyword']);
    expect(byId.b.ranks).toEqual({ semantic: 2, keyword: 1 });
  });

  it('a document found by two retrievers beats one that is first in a single list', () => {
    const out = reciprocalRankFusion([
      { source: 'semantic', ids: ['solo', 'both'] },
      { source: 'keyword', ids: ['x', 'y', 'both'] },
    ]);
    // solo: 1/61 = 0.01639; both: 1/62 + 1/63 = 0.03200
    expect(out[0].id).toBe('both');
  });

  it('ignores duplicates inside one list (first position wins)', () => {
    const out = reciprocalRankFusion([
      { source: 'keyword', ids: ['a', 'b', 'a', 'a'] },
    ]);
    expect(out.map((h) => h.id)).toEqual(['a', 'b']);
    expect(out[0].score).toBeCloseTo(1 / 61);
    expect(out[0].sources).toEqual(['keyword']);
    expect(out[1].ranks.keyword).toBe(2);
  });

  it('works when a retriever is empty or failed (empty list)', () => {
    const out = reciprocalRankFusion([
      { source: 'semantic', ids: [] },
      { source: 'keyword', ids: ['a', 'b'] },
      { source: 'title', ids: [] },
    ]);
    expect(out.map((h) => h.id)).toEqual(['a', 'b']);
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(
      reciprocalRankFusion([
        { source: 'semantic', ids: [] },
        { source: 'keyword', ids: [] },
      ]),
    ).toEqual([]);
  });

  describe('ties', () => {
    it('equal score: the document matched by more retrievers wins', () => {
      // a: rank 1 in a single list (1/61); b: ranks 61 and 61 in two lists has a lower score, so use
      // a custom k to build an exact tie: k=0 -> a: 1/2 ; b: 1/4 + 1/4
      const out = reciprocalRankFusion(
        [
          { source: 'semantic', ids: ['f1', 'a', 'f3', 'b'] },
          { source: 'keyword', ids: ['b2', 'b3', 'b4', 'b'] },
        ],
        { k: 0 },
      );
      const a = out.find((h) => h.id === 'a');
      const b = out.find((h) => h.id === 'b');
      expect(a?.score).toBeCloseTo(b?.score ?? NaN);
      expect(out.findIndex((h) => h.id === 'b')).toBeLessThan(
        out.findIndex((h) => h.id === 'a'),
      );
    });

    it('equal score and sources: better single rank, then earlier list, then id', () => {
      const out = reciprocalRankFusion([
        { source: 'semantic', ids: ['z1'] },
        { source: 'keyword', ids: ['a1'] },
        { source: 'title', ids: ['m1'] },
      ]);
      // all rank 1 in one list each: earlier list first
      expect(out.map((h) => h.id)).toEqual(['z1', 'a1', 'm1']);

      const sameList = reciprocalRankFusion([
        { source: 'keyword', ids: ['b'] },
        { source: 'title', ids: ['a'] },
      ]);
      expect(sameList.map((h) => h.id)).toEqual(['b', 'a']);
    });

    it('is deterministic regardless of Map insertion artefacts', () => {
      const lists = [
        { source: 'semantic' as const, ids: ['c', 'a', 'b'] },
        { source: 'keyword' as const, ids: ['b', 'c', 'a'] },
      ];
      const first = reciprocalRankFusion(lists).map((h) => h.id);
      for (let i = 0; i < 5; i++) {
        expect(reciprocalRankFusion(lists).map((h) => h.id)).toEqual(first);
      }
    });
  });

  it('applies the limit after sorting', () => {
    const out = reciprocalRankFusion(
      [{ source: 'keyword', ids: ['a', 'b', 'c', 'd'] }],
      { limit: 2 },
    );
    expect(out.map((h) => h.id)).toEqual(['a', 'b']);
  });
});
