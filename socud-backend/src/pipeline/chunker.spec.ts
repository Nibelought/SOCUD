import {
  MAX_CHUNK_CHARS,
  OVERLAP_CHARS,
  TARGET_CHUNK_CHARS,
  chunkHtml,
  chunkMarkedText,
} from './chunker';
import { htmlToPlainText } from './html-text';

const para = (n: number, word = 'lorem') =>
  Array.from({ length: n }, () => word).join(' ');

describe('chunkHtml', () => {
  it('returns no chunks for empty or symbol-only content', () => {
    expect(chunkHtml('')).toEqual([]);
    expect(chunkHtml('<p> </p><hr>')).toEqual([]);
  });

  it('keeps a short document in one chunk, headings included, without markers', () => {
    const chunks = chunkHtml(
      '<h1>Guide</h1><p>First paragraph.</p><p>Second paragraph.</p>',
    );
    expect(chunks).toEqual(['Guide\n\nFirst paragraph.\n\nSecond paragraph.']);
  });

  it('does not uppercase headings (html-to-text default)', () => {
    expect(chunkHtml('<h2>Mixed Case</h2><p>text</p>')[0]).toContain(
      'Mixed Case',
    );
  });

  it('starts a new chunk at a heading, without overlap from the previous section', () => {
    const chunks = chunkHtml(
      `<h1>A</h1><p>${para(30)}</p><h1>B</h1><p>${para(30, 'ipsum')}</p>`,
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[1].startsWith('B\n\nipsum')).toBe(true);
    expect(chunks[1]).not.toContain('lorem');
  });

  it('packs paragraphs up to the target and overlaps consecutive chunks', () => {
    const paragraphs = Array.from(
      { length: 12 },
      (_, i) => `P${i} ${para(60, `w${i}`)}`,
    );
    const chunks = chunkHtml(paragraphs.map((p) => `<p>${p}</p>`).join(''));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
    // Overlap: the second chunk starts with the tail of the first.
    const tailOfFirst = chunks[0].slice(-60);
    expect(chunks[1].slice(0, OVERLAP_CHARS + 10)).toContain(
      tailOfFirst.trim().split(' ').slice(-3).join(' '),
    );
    // Paragraph boundaries are respected: every paragraph start is intact in some chunk.
    for (const p of paragraphs) {
      expect(chunks.some((c) => c.includes(p.slice(0, 40)))).toBe(true);
    }
  });

  it('splits a single huge paragraph on sentence boundaries within the limit', () => {
    const sentence = 'This is a sentence of moderate length. ';
    const chunks = chunkHtml(`<p>${sentence.repeat(300)}</p>`);
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
    expect(chunks[0].endsWith('.')).toBe(true);
  });

  it('hard-cuts a token longer than the limit instead of exceeding it', () => {
    const chunks = chunkHtml(`<p>${'x'.repeat(10_000)}</p>`);
    expect(chunks.length).toBeGreaterThanOrEqual(5);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
  });

  it('never exceeds the worker cap, even for a very long document', () => {
    const html = Array.from(
      { length: 500 },
      (_, i) => `<p>${para(80, `word${i}`)}</p>`,
    ).join('');
    const chunks = chunkHtml(html);
    expect(chunks.length).toBeGreaterThan(32); // more than one embed batch
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(
      MAX_CHUNK_CHARS,
    );
  });
});

describe('chunkMarkedText', () => {
  it('honours custom target and drops chunks without letters or digits', () => {
    expect(chunkMarkedText('---\n\n***')).toEqual([]);
    const chunks = chunkMarkedText(`${para(40)}\n\n${para(40)}`, {
      target: 250,
      overlap: 0,
    });
    expect(chunks).toHaveLength(2);
  });

  it('exposes sane constants', () => {
    expect(TARGET_CHUNK_CHARS + OVERLAP_CHARS).toBe(MAX_CHUNK_CHARS);
    expect(MAX_CHUNK_CHARS).toBeLessThan(15_000);
  });
});

describe('htmlToPlainText', () => {
  it('flattens lists and drops link targets', () => {
    const text = htmlToPlainText(
      '<h1>T</h1><ul><li>one</li><li>two</li></ul><p><a href="/document/x">see this</a></p>',
    );
    expect(text).toContain('T');
    expect(text).toContain('* one');
    expect(text).toContain('see this');
    expect(text).not.toContain('/document/x');
    expect(text).not.toContain('\u0001');
  });
});
