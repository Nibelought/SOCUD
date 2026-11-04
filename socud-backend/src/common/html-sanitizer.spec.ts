import { sanitizeDocumentHtml } from './html-sanitizer';

describe('sanitizeDocumentHtml', () => {
  it('strips <script> tags together with their content', () => {
    const out = sanitizeDocumentHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toBe('<p>hi</p>');
  });

  it('strips event handler attributes', () => {
    const out = sanitizeDocumentHtml(
      '<p onclick="x()" onmouseover="y()">a</p>',
    );
    expect(out).toBe('<p>a</p>');
    expect(sanitizeDocumentHtml('<img src=x onerror=alert(1)>')).toBe('');
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    '//evil.example/x',
  ])('drops the dangerous href %j', (href) => {
    const out = sanitizeDocumentHtml(`<a href="${href}">x</a>`);
    expect(out).not.toMatch(/href/i);
    expect(out).toContain('x');
  });

  it('strips iframe, object, embed, img, style and form tags', () => {
    const out = sanitizeDocumentHtml(
      '<iframe src="https://evil.example"></iframe><object data="x"></object>' +
        '<embed src="x"><img src="https://x/y.png"><style>p{}</style><form><input></form><p>ok</p>',
    );
    expect(out).toBe('<p>ok</p>');
  });

  it('strips style attributes', () => {
    const out = sanitizeDocumentHtml(
      '<p style="position:fixed">a</p><span style="color:red" data-type="inlineMath" data-latex="x">x</span>',
    );
    expect(out).not.toContain('style');
  });

  it('keeps a math span with its data attributes', () => {
    const html =
      '<span data-type="inlineMath" data-latex="\\frac{a}{b}" data-evaluate="no" data-display="no">$\\frac{a}{b}$</span>';
    const out = sanitizeDocumentHtml(html);
    expect(out).toContain('data-type="inlineMath"');
    expect(out).toContain('data-latex="\\frac{a}{b}"');
    expect(out).toContain('data-evaluate="no"');
    expect(out).toContain('data-display="no"');
  });

  it.each(['yes', 'no', 'true', 'false'])(
    'keeps data-display="%s" (PasteMarkdown emits true)',
    (value) => {
      const out = sanitizeDocumentHtml(
        `<span data-type="displayMath" data-latex="x" data-display="${value}">$$x$$</span>`,
      );
      expect(out).toContain(`data-display="${value}"`);
    },
  );

  it('drops other data-display values', () => {
    const out = sanitizeDocumentHtml(
      '<span data-type="displayMath" data-latex="x" data-display="javascript:1">x</span>',
    );
    expect(out).not.toMatch(/data-display="javascript/);
  });

  it('rejects unknown data-type values and escapes hostile data-latex content', () => {
    const out = sanitizeDocumentHtml(
      '<span data-type="evil" data-latex="&quot;><script>alert(1)</script>">x</span>',
    );
    expect(out).not.toContain('evil');
    expect(out).not.toMatch(/data-type=/);
    expect(out).not.toContain('<script');
  });

  it('keeps a code block with a language-ts class but drops other classes', () => {
    const out = sanitizeDocumentHtml(
      '<pre class="hljs fixed"><code class="language-ts evil">const a = 1;</code></pre>',
    );
    expect(out).toBe(
      '<pre class="hljs"><code class="language-ts">const a = 1;</code></pre>',
    );
  });

  it('keeps relative and https links and adds rel="noopener noreferrer"', () => {
    const out = sanitizeDocumentHtml(
      '<a href="/document/3f2b8c1e-8a4d-4f5e-9b1a-2c3d4e5f6a7b" target="_blank">doc</a>' +
        '<a href="https://example.com/a?b=1" title="t" rel="opener">ext</a>' +
        '<a href="mailto:a@b.co">m</a><a href="#top">top</a>',
    );
    expect(out).toContain(
      '<a href="/document/3f2b8c1e-8a4d-4f5e-9b1a-2c3d4e5f6a7b" rel="noopener noreferrer">doc</a>',
    );
    expect(out).toContain(
      '<a href="https://example.com/a?b=1" title="t" rel="noopener noreferrer">ext</a>',
    );
    expect(out).toContain('href="mailto:a@b.co"');
    expect(out).toContain('href="#top"');
    expect(out).not.toContain('target=');
    expect(out).not.toContain('opener"');
  });

  it('keeps ordinary editor formatting', () => {
    const html =
      '<h1>T</h1><p><strong>b</strong> <em>i</em> <s>s</s> <code>c</code><br /></p><hr />' +
      '<blockquote><p>q</p></blockquote><ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol>';
    expect(sanitizeDocumentHtml(html)).toBe(html);
  });
});
