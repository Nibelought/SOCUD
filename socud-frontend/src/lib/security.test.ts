import { describe, expect, it } from 'vitest';
import { isSafeHref, sanitizeDocumentHtml, KATEX_OPTIONS } from './security';

describe('isSafeHref', () => {
  const safe: string[] = [
    'http://example.com',
    'https://example.com/path?q=1#frag',
    'HTTPS://EXAMPLE.COM',
    'mailto:user@example.com',
    'MAILTO:user@example.com',
    '/document/123e4567-e89b-12d3-a456-426614174000',
    './sibling',
    '../parent/doc',
    '#section-1',
    '/search?q=a:b',
    '  https://example.com  ',
  ];
  const unsafe: string[] = [
    '',
    '   ',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)',
    '\u0001javascript:alert(1)',
    '\tjavascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java\r\nscript:alert(1)',
    'java\u0000script:alert(1)',
    '​javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'DATA:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://example.com/uuid',
    'ftp://example.com/file',
    '//evil.com',
    '//evil.com/path',
    '\\\\evil.com',
    '/\\evil.com',
    '/\t/evil.com',
    '&#106;avascript:alert(1)',
    '&#x6A;avascript:alert(1)',
    'javascript&colon;alert(1)',
    'javascript&#58;alert(1)',
    'javascript%3Aalert(1)',
    'javascript%3aalert(1)',
    ' \u0000 data:text/html,x',
  ];

  it.each(safe)('accepts %j', (href) => {
    expect(isSafeHref(href)).toBe(true);
  });

  it.each(unsafe)('rejects %j', (href) => {
    expect(isSafeHref(href)).toBe(false);
  });

  it('has at least 20 cases', () => {
    expect(safe.length + unsafe.length).toBeGreaterThanOrEqual(20);
  });

  it('rejects non-strings', () => {
    expect(isSafeHref(undefined as unknown as string)).toBe(false);
    expect(isSafeHref(null as unknown as string)).toBe(false);
  });
});

describe('sanitizeDocumentHtml', () => {
  const parse = (html: string) => {
    const root = document.createElement('div');
    root.innerHTML = sanitizeDocumentHtml(html);
    return root;
  };

  it('removes script tags and their content', () => {
    const out = sanitizeDocumentHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toBe('<p>hi</p>');
  });

  it('removes event handler attributes', () => {
    const root = parse('<p onclick="alert(1)" onmouseover="x()">a</p><span onerror="x()">b</span>');
    expect(root.querySelector('[onclick],[onmouseover],[onerror]')).toBeNull();
    expect(root.textContent).toBe('ab');
  });

  it('removes img with onerror', () => {
    const out = sanitizeDocumentHtml('<img src=x onerror=alert(1)>text');
    expect(out).toBe('text');
  });

  it('removes javascript: hrefs but keeps the link text', () => {
    const root = parse('<a href="javascript:alert(1)">click</a><a href=" JaVa\tScRiPt:alert(2)">two</a>');
    for (const a of Array.from(root.querySelectorAll('a'))) {
      expect(a.hasAttribute('href')).toBe(false);
    }
    expect(root.textContent).toBe('clicktwo');
  });

  it('removes data: and protocol-relative hrefs', () => {
    const root = parse('<a href="data:text/html,x">a</a><a href="//evil.com">b</a>');
    expect(root.querySelectorAll('a[href]').length).toBe(0);
  });

  it('removes iframe, object, embed, form', () => {
    const out = sanitizeDocumentHtml(
      '<iframe src="https://evil.com"></iframe><object data="x"></object><embed src="x"><form action="https://evil.com"><input name=a></form>ok',
    );
    expect(out).not.toMatch(/<(iframe|object|embed|form|input)/i);
    expect(out).toContain('ok');
  });

  it('removes style tags and style attributes', () => {
    const root = parse('<style>body{display:none}</style><p style="position:fixed">x</p>');
    expect(root.querySelector('style')).toBeNull();
    expect(root.querySelector('[style]')).toBeNull();
    expect(root.textContent).toBe('x');
  });

  it('removes svg with onload and math tags', () => {
    const out = sanitizeDocumentHtml('<svg onload="alert(1)"><circle/></svg><math><mi>x</mi></math>after');
    expect(out).not.toMatch(/<(svg|math|circle|mi)/i);
    expect(out).not.toMatch(/onload/i);
    expect(out).toContain('after');
  });

  it('survives mutation-XSS style payloads', () => {
    const out = sanitizeDocumentHtml('<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">');
    expect(out).not.toMatch(/<img|onerror=/i);
  });

  it('keeps a math span with its data attributes', () => {
    const root = parse(
      '<span data-type="inlineMath" data-latex="E = mc^2" data-display="no" data-evaluate="no" class="tiptap-math">$E = mc^2$</span>',
    );
    const span = root.querySelector('span');
    expect(span).not.toBeNull();
    expect(span!.getAttribute('data-type')).toBe('inlineMath');
    expect(span!.getAttribute('data-latex')).toBe('E = mc^2');
    expect(span!.getAttribute('data-display')).toBe('no');
    expect(span!.getAttribute('class')).toBe('tiptap-math');
    expect(span!.hasAttribute('data-evaluate')).toBe(false);
    expect(span!.textContent).toBe('$E = mc^2$');
  });

  it('keeps latex/display attributes on span and div', () => {
    const root = parse('<div latex="x^2" display="true">x</div><span latex="y">y</span>');
    expect(root.querySelector('div')!.getAttribute('latex')).toBe('x^2');
    expect(root.querySelector('div')!.getAttribute('display')).toBe('true');
    expect(root.querySelector('span')!.getAttribute('latex')).toBe('y');
  });

  it('keeps pre > code.language-ts and highlight spans', () => {
    const root = parse('<pre class="hljs"><code class="language-ts evil"><span class="hljs-keyword">const</span> a</code></pre>');
    const code = root.querySelector('pre > code');
    expect(code).not.toBeNull();
    expect(code!.getAttribute('class')).toBe('language-ts');
    expect(root.querySelector('pre')!.getAttribute('class')).toBe('hljs');
    expect(root.querySelector('span.hljs-keyword')!.textContent).toBe('const');
  });

  it('drops class on elements other than span/div/code/pre', () => {
    const root = parse('<p class="fixed inset-0">x</p>');
    expect(root.querySelector('p')!.hasAttribute('class')).toBe(false);
  });

  it('keeps relative document links and adds rel', () => {
    const root = parse('<a href="/document/123e4567-e89b-12d3-a456-426614174000" target="_blank">doc</a>');
    const a = root.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('/document/123e4567-e89b-12d3-a456-426614174000');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.hasAttribute('target')).toBe(false);
  });

  it('keeps https links, overrides supplied rel, and keeps title', () => {
    const root = parse('<a href="https://example.com/a?b=1" rel="opener" title="T">x</a>');
    const a = root.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://example.com/a?b=1');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.getAttribute('title')).toBe('T');
  });

  it('keeps mailto and fragment links', () => {
    const root = parse('<a href="mailto:a@b.co">m</a><a href="#x">f</a>');
    expect(root.querySelectorAll('a[href]').length).toBe(2);
  });

  it('keeps basic formatting tags from the allowlist', () => {
    const html = '<h1>t</h1><p><strong>b</strong><em>i</em><s>s</s><br></p><hr><blockquote>q</blockquote><ul><li>a</li></ul><ol><li>b</li></ol>';
    expect(sanitizeDocumentHtml(html)).toBe(html);
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeDocumentHtml('')).toBe('');
  });
});

describe('KATEX_OPTIONS', () => {
  it('is locked down', () => {
    expect(KATEX_OPTIONS.trust).toBe(false);
    expect(KATEX_OPTIONS.throwOnError).toBe(false);
    expect(KATEX_OPTIONS.maxSize).toBeGreaterThan(0);
    expect(KATEX_OPTIONS.maxExpand).toBeGreaterThan(0);
  });
});
