import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cleanContent,
  l2Normalize,
  mrlTruncate,
  prepareText,
} from './embedding-text';
import { DEFAULT_QUERY_INSTRUCTION } from './api-embedding.provider';

interface Fixtures {
  defaultTask: string;
  cases: { text: string; isQuery: boolean; task: string; expected: string }[];
}

/**
 * Fixtures are produced by the real Python `prepare_text`
 * (socud-ai-worker/scripts/gen_prepare_text_fixtures.py), so this is a parity test between the
 * worker and the TypeScript port used by EMBEDDING_PROVIDER=api.
 */
const fixtures = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'prepare-text.json'), 'utf8'),
) as Fixtures;

describe('prepareText parity with socud-ai-worker/embedder.py', () => {
  it('has a substantial fixture set', () => {
    expect(fixtures.cases.length).toBeGreaterThan(1000);
    expect(fixtures.cases.some((c) => c.isQuery)).toBe(true);
    expect(fixtures.cases.some((c) => !c.isQuery)).toBe(true);
  });

  it("uses the worker's default query instruction", () => {
    expect(DEFAULT_QUERY_INSTRUCTION).toBe(fixtures.defaultTask);
  });

  it('produces exactly the strings the Python code produced', () => {
    const mismatches = fixtures.cases
      .map((c, i) => ({ c, i, actual: prepareText(c.text, c.isQuery, c.task) }))
      .filter(({ c, actual }) => actual !== c.expected)
      .slice(0, 5)
      .map(({ c, i, actual }) => ({
        case: i,
        input: JSON.stringify(c.text.slice(0, 120)),
        expected: JSON.stringify(c.expected.slice(0, 120)),
        actual: JSON.stringify(actual.slice(0, 120)),
      }));
    expect(mismatches).toEqual([]);
  });
});

describe('cleanContent / prepareText', () => {
  it('strips markdown markers and keeps words, code and intra-word underscores', () => {
    expect(
      cleanContent('# Title\n\n**bold** [link](http://x) snake_case\n- item'),
    ).toBe('Title\n\nbold link snake_case\nitem');
  });

  it('adds the instruction to queries only, with no space after "Query:"', () => {
    expect(prepareText('hi', true, 'T')).toBe('Instruct: T\nQuery:hi');
    expect(prepareText('hi', false, 'T')).toBe('hi');
  });

  it('adds no instruction when no task is given', () => {
    expect(prepareText('**hi**', true)).toBe('hi');
    expect(prepareText('hi', true, '')).toBe('hi');
  });

  it('maps empty and whitespace-only input to the empty string', () => {
    expect(cleanContent('')).toBe('');
    expect(cleanContent(' \n\t   ')).toBe('');
  });
});

describe('mrlTruncate', () => {
  it('keeps the first components and renormalises to unit length', () => {
    const out = mrlTruncate([3, 4, 12], 2);
    expect(out[0]).toBeCloseTo(0.6);
    expect(out[1]).toBeCloseTo(0.8);
  });

  it('rejects an impossible dimension', () => {
    expect(() => mrlTruncate([1, 2], 3)).toThrow(RangeError);
    expect(() => mrlTruncate([1, 2], 0)).toThrow(RangeError);
  });

  it('l2Normalize leaves a zero vector finite', () => {
    expect(l2Normalize([0, 0])).toEqual([0, 0]);
  });
});
