import { HEADLINE_START as S, HEADLINE_STOP as E } from './search.constants';
import { parseHeadline, plainSnippet } from './snippet';

describe('plainSnippet', () => {
  it('collapses whitespace and strips control characters', () => {
    expect(plainSnippet('a\n\n  b\u0001c\u0000d\t e')).toBe('a b c d e');
  });

  it('does not HTML-escape and does not add markup (rendered as a text node)', () => {
    const evil = '<img src=x onerror=alert(1)> & <script>x</script> "q"';
    expect(plainSnippet(evil)).toBe(evil);
  });

  it('cuts long text at a word boundary with an ASCII ellipsis', () => {
    const out = plainSnippet('слово '.repeat(100), 50);
    expect(out.endsWith('...')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(53);
    expect(out.slice(0, -3).endsWith('слово')).toBe(true);
  });

  it('handles null and empty input', () => {
    expect(plainSnippet(null)).toBe('');
    expect(plainSnippet(undefined)).toBe('');
    expect(plainSnippet('   ')).toBe('');
  });
});

describe('parseHeadline', () => {
  it('returns plain text without markers and the matched ranges', () => {
    const { text, highlights } = parseHeadline(
      `Как настроить ${S}деплой${E} сервера и ${S}deploy${E}`,
    );
    expect(text).toBe('Как настроить деплой сервера и deploy');
    expect(highlights.map((h) => text.slice(h.start, h.end))).toEqual([
      'деплой',
      'deploy',
    ]);
    expect(text).not.toContain(S);
    expect(text).not.toContain(E);
  });

  it('keeps hostile markup as literal text', () => {
    const { text, highlights } = parseHeadline(
      `<b>bold</b> ${S}<img src=x onerror=alert(1)>${E} &amp;`,
    );
    expect(text).toBe('<b>bold</b> <img src=x onerror=alert(1)> &amp;');
    expect(text.slice(highlights[0].start, highlights[0].end)).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('collapses whitespace around highlights consistently', () => {
    const { text, highlights } = parseHeadline(`a \n ${S}b${E}\n\nc`);
    expect(text).toBe('a b c');
    expect(text.slice(highlights[0].start, highlights[0].end)).toBe('b');
  });

  it('clips long headlines and keeps highlights inside the clipped text', () => {
    const long = `${S}start${E} ${'word '.repeat(100)}${S}tail${E}`;
    const { text, highlights } = parseHeadline(long, 40);
    expect(text.length).toBeLessThanOrEqual(43);
    expect(highlights).toHaveLength(1);
    expect(text.slice(highlights[0].start, highlights[0].end)).toBe('start');
  });

  it('ignores unbalanced markers', () => {
    const { text, highlights } = parseHeadline(`x ${S}open and ${E}${E}`);
    expect(text).toBe('x open and');
    expect(highlights).toHaveLength(1);
  });
});
